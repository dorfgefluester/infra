pipeline {
    agent any

    parameters {
        booleanParam(name: 'RUN_E2E', defaultValue: false, description: 'Run Playwright E2E tests')
    }

    options {
        buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
        timeout(time: 45, unit: 'MINUTES')
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    environment {
        PROJECT_NAME = 'dorfgefluester'
        IMAGE_NAME = 'dorfgefluester'
        NODE_VERSION = '20'
        NODE_MAJOR_REQUIRED = '18'
        REGISTRY = 'dev-env-01:5000'
        IMAGE_REPO = "${REGISTRY}/${IMAGE_NAME}"
        DEPLOY_HOST = 'dev-env-01'
        DEPLOY_USER = 'deploy'
        SSH_CRED_ID = 'dev-env-01-ssh'
        NAMESPACE = 'dev'
        RELEASE = 'dorfgefluester'
        BUILD_ALLOWED = 'true'
        GIT_SHA = ''
        IMAGE_TAG = ''
        SONAR_ANALYSIS_DONE = 'false'
    }

    stages {
        // Build only the latest semantic-version branch to reduce redundant CI load.
        stage('Gate: Latest Version Branch') {
            steps {
                script {
                    def isVersionBranch = (env.BRANCH_NAME ==~ /\d+\.\d+\.\d+/)
                    if (isVersionBranch) {
                        def credId = scm.userRemoteConfigs[0].credentialsId
                        def repoUrl = scm.userRemoteConfigs[0].url
                        def latest = ''
                        withCredentials([gitUsernamePassword(credentialsId: credId, gitToolName: 'Default')]) {
                            retry(3) {
                                latest = sh(
                                    script: "git ls-remote --heads '${repoUrl}' | cut -f2 | sed 's#refs/heads/##' | grep -E -x '[0-9]+\\.[0-9]+\\.[0-9]+' | sort -V | tail -n 1",
                                    returnStdout: true
                                ).trim()
                            }
                        }
                        env.LATEST_VERSION_BRANCH = latest
                        if (env.BRANCH_NAME != latest) {
                            env.BUILD_ALLOWED = 'false'
                            currentBuild.result = 'NOT_BUILT'
                            echo "Skipping build for ${env.BRANCH_NAME} (latest is ${latest})."
                        } else {
                            echo "Building latest version branch: ${latest}."
                        }
                    } else {
                        echo "Non-version branch (${env.BRANCH_NAME}); continuing."
                    }
                }
            }
        }

        // Run compile, lint, tests, and optional E2E in a Node 20 container for parity across projects.
        stage('CI') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            agent {
                docker {
                    image "node:${NODE_VERSION}"
                    args "-u root:root --entrypoint=''"
                    reuseNode true
                }
            }
            stages {
                // Perform a resilient checkout and set a deterministic image tag from git SHA.
                stage('Checkout') {
                    steps {
                        script {
                            for (int attempt = 1; attempt <= 3; attempt++) {
                                try {
                                    checkout scm
                                    break
                                } catch (err) {
                                    if (attempt == 3) {
                                        throw err
                                    }
                                    int waitSeconds = 10 * attempt
                                    echo "Checkout attempt ${attempt} failed: ${err.getMessage()}"
                                    echo "Retrying checkout in ${waitSeconds}s..."
                                    sleep time: waitSeconds, unit: 'SECONDS'
                                }
                            }
                            env.GIT_SHA = env.GIT_COMMIT?.take(7)
                            if (!env.GIT_SHA?.trim()) {
                                sh 'git config --global --add safe.directory "$WORKSPACE"'
                                env.GIT_SHA = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                            }
                            env.IMAGE_TAG = env.GIT_SHA
                        }
                    }
                }

                // Verify runtime versions early so incompatible agents fail fast.
                stage('Verify Tooling') {
                    steps {
                        sh 'node --version'
                        sh 'npm --version'
                        script {
                            def nodeVersion = sh(script: 'node --version', returnStdout: true).trim()
                            def major = nodeVersion.replaceAll(/v(\d+)\..*/, '$1').toInteger()
                            if (major < NODE_MAJOR_REQUIRED.toInteger()) {
                                error("Node.js ${nodeVersion} is older than required v${NODE_MAJOR_REQUIRED}.x")
                            }
                        }
                    }
                }

                // Install locked dependencies for reproducible builds and consistent scans.
                stage('Install Dependencies') {
                    steps {
                        sh 'npm ci --prefer-offline --no-audit'
                    }
                }

                // Build production assets early so downstream stages validate real outputs.
                stage('Build') {
                    steps {
                        sh 'npm run build'
                    }
                    post {
                        success {
                            archiveArtifacts artifacts: 'dist/**/*', fingerprint: true, allowEmptyArchive: false
                        }
                    }
                }

                // Run static checks and test execution in parallel to reduce CI cycle time.
                stage('Lint & Test') {
                    parallel {
                        // Enforce lint rules before delivery to keep code quality consistent.
                        stage('Lint') {
                            steps {
                                sh 'npm run lint --if-present -- --max-warnings=0'
                                sh 'npm run format:check --if-present'
                            }
                        }

                        // Execute tests and publish JUnit-compatible reports for Jenkins visibility.
                        stage('Test') {
                            steps {
                                script {
                                    def junitDir = 'tests/junit'
                                    def hasJunit = sh(script: '[ -d node_modules/jest-junit ]', returnStatus: true) == 0
                                    sh "mkdir -p ${junitDir}"
                                    if (hasJunit) {
                                        withEnv(["JEST_JUNIT_OUTPUT_DIR=${junitDir}", "JEST_JUNIT_OUTPUT_NAME=jest-junit.xml"]) {
                                            sh 'npm test -- --ci --coverage=false --reporters=default --reporters=jest-junit'
                                        }
                                    } else {
                                        sh 'npm test -- --ci --coverage=false --json --outputFile=tests/junit/jest.json'
                                        sh 'node scripts/jest-json-to-junit.cjs tests/junit/jest.json tests/junit/jest-junit.xml'
                                    }
                                }
                            }
                            post {
                                always {
                                    junit testResults: 'tests/junit/**/*.xml', allowEmptyResults: true
                                }
                            }
                        }
                    }
                }

                // Publish coverage as a non-blocking quality signal to avoid halting delivery.
                stage('Coverage (Non-Blocking)') {
                    steps {
                        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                            sh 'npm run test:coverage --if-present'
                        }
                    }
                    post {
                        always {
                            archiveArtifacts artifacts: 'tests/coverage/**/*', fingerprint: true, allowEmptyArchive: true
                        }
                    }
                }

                // Run optional E2E only when explicitly requested on master to control runtime.
                stage('E2E (Optional)') {
                    when {
                        expression { return params.RUN_E2E && env.BRANCH_NAME == 'master' }
                    }
                    steps {
                        sh 'npm run test:e2e'
                    }
                }
            }
        }

        // Run code-quality analysis and security checks in parallel for faster feedback.
        stage('Analysis & Security') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            parallel {
                // Send source and coverage data to SonarQube for centralized quality metrics.
                stage('SonarQube Analysis') {
                    steps {
                        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                            withSonarQubeEnv('SonarQube') {
                                sh '''
                                    docker run --rm \
                                      -e SONAR_HOST_URL="$SONAR_HOST_URL" \
                                      -e SONAR_TOKEN="$SONAR_AUTH_TOKEN" \
                                      -v "$WORKSPACE:/usr/src" \
                                      sonarsource/sonar-scanner-cli:11 \
                                      sonar-scanner \
                                        -Dsonar.projectKey=dorfgefluester \
                                        -Dsonar.projectName="Dorfgefluester" \
                                        -Dsonar.sources=. \
                                        -Dsonar.exclusions=**/node_modules/**,**/dist/**,**/tests/**,**/coverage/** \
                                        -Dsonar.javascript.lcov.reportPaths=tests/coverage/lcov.info \
                                        -Dsonar.host.url="$SONAR_HOST_URL"
                                '''
                            }
                            script {
                                env.SONAR_ANALYSIS_DONE = 'true'
                            }
                        }
                    }
                }

                // Execute independent security scans in parallel so one slow scan does not block others.
                stage('Security Scans') {
                    steps {
                        script {
                            parallel(
                                // Scan the repository filesystem for high/critical issues without failing the pipeline.
                                'Trivy FS Scan': {
                                    sh '''
                                        docker run --rm -v "$WORKSPACE:/src" \
                                          aquasec/trivy fs /src \
                                          --exit-code 0 --severity HIGH,CRITICAL --ignore-unfixed || true
                                    '''
                                },
                                // Run Semgrep SAST ruleset for fast pattern-based vulnerability detection.
                                'Semgrep': {
                                    sh '''
                                        docker run --rm -v "$WORKSPACE:/src" \
                                          returntocorp/semgrep semgrep scan /src \
                                          --config auto --error || true
                                    '''
                                },
                                // Run npm audit as a dependency-risk signal while keeping delivery non-blocking.
                                'npm Audit': {
                                    sh 'npm audit --audit-level=high || true'
                                }
                            )
                        }
                    }
                }
            }
        }

        // Evaluate SonarQube quality gate and mark UNSTABLE instead of failing hard on gate errors.
        stage('Quality Gate') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' && env.SONAR_ANALYSIS_DONE == 'true' }
            }
            steps {
                catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                    timeout(time: 5, unit: 'MINUTES') {
                        script {
                            def qg = waitForQualityGate()
                            if (qg.status != 'OK') {
                                unstable("Quality gate failed: ${qg.status}")
                            }
                        }
                    }
                }
            }
        }

        // Validate Helm chart rendering in CI so deployment failures are caught pre-release.
        stage('Helm Validation (Parallel)') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            parallel {
                // Lint chart templates to catch syntax and schema issues before deployment.
                stage('Helm Lint') {
                    steps {
                        script {
                            def hasHelm = sh(script: 'command -v helm >/dev/null 2>&1', returnStatus: true) == 0
                            if (hasHelm) {
                                sh 'helm lint helm/dorfgefluester'
                            } else {
                                echo 'Helm not found on agent; skipping Helm Lint.'
                            }
                        }
                    }
                }

                // Render manifests and run client-side apply to verify Kubernetes compatibility.
                stage('Helm Render (Dry Run)') {
                    steps {
                        script {
                            def hasHelm = sh(script: 'command -v helm >/dev/null 2>&1', returnStatus: true) == 0
                            def hasKubectl = sh(script: 'command -v kubectl >/dev/null 2>&1', returnStatus: true) == 0
                            if (hasHelm && hasKubectl) {
                                sh """
                                  helm template ${RELEASE} helm/dorfgefluester \
                                    --namespace ${NAMESPACE} \
                                    --set image.repository=${IMAGE_REPO} \
                                    --set image.tag=ci-dry-run \
                                    --set ingress.host=dorf.test > /tmp/${RELEASE}-rendered.yaml
                                  kubectl apply --dry-run=client -f /tmp/${RELEASE}-rendered.yaml
                                """
                            } else {
                                echo 'Helm or kubectl not found on agent; skipping Helm Render (Dry Run).'
                            }
                        }
                    }
                }
            }
        }

        // Build, scan, push, and archive metadata for the deployable container image.
        stage('Docker Build, Scan & Push') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
                anyOf {
                    branch pattern: '0.*', comparator: 'GLOB'
                    branch 'staging'
                    branch 'master'
                }
            }
            stages {
                // Build the immutable SHA-tagged image that will be scanned and published.
                stage('Build Docker Image') {
                    steps {
                        script {
                            if (!env.IMAGE_TAG?.trim()) {
                                sh 'git config --global --add safe.directory "$WORKSPACE"'
                                env.GIT_SHA = env.GIT_COMMIT?.take(7) ?: sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                                env.IMAGE_TAG = env.GIT_SHA
                                echo "IMAGE_TAG was empty; resolved fallback tag ${env.IMAGE_TAG}."
                            }
                        }
                        sh 'docker build -t ${IMAGE_REPO}:${IMAGE_TAG} .'
                    }
                }

                // Scan the built image for high/critical vulnerabilities before publishing.
                stage('Scan Docker Image') {
                    steps {
                        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                            sh '''
                                docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
                                  aquasec/trivy image \
                                  --exit-code 1 --severity HIGH,CRITICAL --ignore-unfixed \
                                  "$IMAGE_REPO:$IMAGE_TAG"
                            '''
                        }
                    }
                }

                // Push directly when possible and fallback via deploy host for insecure-registry setups.
                stage('Push Docker Image') {
                    steps {
                        script {
                            def directPushStatus = sh(script: 'docker push ${IMAGE_REPO}:${IMAGE_TAG}', returnStatus: true)
                            if (directPushStatus == 0) {
                                echo 'Image pushed directly from Jenkins agent.'
                            } else {
                                echo "Direct push failed (likely insecure registry/TLS mismatch). Falling back to push via ${DEPLOY_HOST}."
                                def imageArchive = "/tmp/${RELEASE}-${IMAGE_TAG}.tar.gz"
                                sshagent(credentials: [env.SSH_CRED_ID]) {
                                    sh """
                                      set -e
                                      docker save ${IMAGE_REPO}:${IMAGE_TAG} | gzip > ${imageArchive}
                                      scp -o StrictHostKeyChecking=no ${imageArchive} ${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/
                                      ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
                                        set -e
                                        IMAGE_ARCHIVE=${imageArchive}
                                        if docker info >/dev/null 2>&1; then
                                          DOCKER_CMD="docker"
                                        elif sudo -n docker info >/dev/null 2>&1; then
                                          DOCKER_CMD="sudo docker"
                                        else
                                          echo "Docker is not available for user ${DEPLOY_USER} on ${DEPLOY_HOST}."
                                          exit 1
                                        fi
                                        gunzip -c \$IMAGE_ARCHIVE | \$DOCKER_CMD load
                                        \$DOCKER_CMD push ${IMAGE_REPO}:${IMAGE_TAG}
                                        rm -f \$IMAGE_ARCHIVE
                                      '
                                      rm -f ${imageArchive}
                                    """
                                }
                            }
                        }
                    }
                }

                // Archive build metadata so downstream deploy jobs can consume image details reliably.
                stage('Archive Build Metadata') {
                    steps {
                        sh """
                          cat > build-meta.json <<EOF
                          {
                            "gitSha": "${env.GIT_SHA}",
                            "imageTag": "${env.IMAGE_TAG}",
                            "branch": "${env.BRANCH_NAME}",
                            "buildNumber": "${env.BUILD_NUMBER}",
                            "registry": "${env.REGISTRY}",
                            "image": "${env.IMAGE_REPO}:${env.IMAGE_TAG}"
                          }
                          EOF
                        """
                        archiveArtifacts artifacts: 'build-meta.json', allowEmptyArchive: false
                    }
                }
            }
            post {
                success {
                    echo "Image published: ${IMAGE_REPO}:${IMAGE_TAG}"
                    echo "Use dedicated deploy pipelines for environment rollout (e.g. jenkins/*-deploy.Jenkinsfile)."
                }
            }
        }
    }

    post {
        always {
            // Clean workspace and reclaim dangling docker artifacts after each run.
            cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)
            sh 'docker system prune -f || true'
        }
    }
}
