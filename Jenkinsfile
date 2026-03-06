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
        NODE_MAJOR_REQUIRED = '18'
        BUILD_ALLOWED = 'true'
        REGISTRY = 'dev-env-01:5000'
        IMAGE_REPO = "${REGISTRY}/dorfgefluester"
        DEPLOY_HOST = 'dev-env-01'
        DEPLOY_USER = 'deploy'
        SSH_CRED_ID = 'dev-env-01-ssh'
        NAMESPACE = 'dev'
        RELEASE = 'dorfgefluester'
    }

    stages {
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

        stage('Checkout') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
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
                }
                sh 'git rev-parse --short HEAD'
            }
        }

        stage('Verify Tooling') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
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

        stage('Install') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                sh 'npm ci --prefer-offline --no-audit'
            }
        }

        stage('Code Quality (Parallel)') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            parallel {
                stage('Lint') {
                    steps {
                        sh 'npm run lint --if-present -- --max-warnings=0'
                    }
                }
                stage('Format Check') {
                    steps {
                        sh 'npm run format:check --if-present'
                    }
                }
            }
        }

        stage('Test') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                script {
                    def junitDir = 'tests/junit'
                    def hasJunit = sh(script: '[ -d node_modules/jest-junit ]', returnStatus: true) == 0
                    if (hasJunit) {
                        sh "mkdir -p ${junitDir}"
                        withEnv(["JEST_JUNIT_OUTPUT_DIR=${junitDir}", "JEST_JUNIT_OUTPUT_NAME=jest-junit.xml"]) {
                            sh 'npm test -- --ci --coverage=false --reporters=default --reporters=jest-junit'
                        }
                    } else {
                        sh "mkdir -p ${junitDir}"
                        sh 'npm test -- --ci --coverage=false --json --outputFile=tests/junit/jest.json'
                        sh 'node scripts/jest-json-to-junit.cjs tests/junit/jest.json tests/junit/jest-junit.xml'
                    }
                }
            }
            post {
                always {
                    script {
                        def hasReports = sh(script: "find tests/junit -type f -name '*.xml' -maxdepth 2 >/dev/null 2>&1", returnStatus: true) == 0
                        if (hasReports) {
                            junit testResults: 'tests/junit/**/*.xml', allowEmptyResults: true
                        } else {
                            echo 'No JUnit reports found; skipping junit publishing.'
                        }
                    }
                }
            }
        }

        stage('Coverage (Non-Blocking)') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
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

        stage('E2E (Optional)') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' && params.RUN_E2E && env.BRANCH_NAME == 'master' }
            }
            steps {
                sh 'npm run test:e2e'
            }
        }

        stage('Build') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                sh 'npm run build'
            }
            post {
                success {
                    archiveArtifacts artifacts: 'dist/**/*', fingerprint: true, allowEmptyArchive: false
                }
            }
        }

        stage('Helm Validation (Parallel)') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            parallel {
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

        stage('Build Image') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
                anyOf {
                    branch pattern: '0.*', comparator: 'GLOB'
                    branch 'staging'
                    branch 'master'
                }
            }
            steps {
                script {
                    env.IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                }
                sh 'docker build -t ${IMAGE_REPO}:${IMAGE_TAG} .'
                script {
                    def directPushStatus = sh(script: 'docker push ${IMAGE_REPO}:${IMAGE_TAG}', returnStatus: true)

                    if (directPushStatus == 0) {
                        echo 'Image pushed directly from Jenkins agent.'
                    } else {
                        echo "Direct push failed (likely insecure registry/TLS mismatch). Falling back to push via ${DEPLOY_HOST}."

                        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
                            sh """
                              set -e
                              docker save ${IMAGE_REPO}:${IMAGE_TAG} | gzip > /tmp/${RELEASE}-${IMAGE_TAG}.tar.gz
                              scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no /tmp/${RELEASE}-${IMAGE_TAG}.tar.gz ${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/
                              ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
                                set -e
                                if docker info >/dev/null 2>&1; then
                                  DOCKER_CMD="docker"
                                elif sudo -n docker info >/dev/null 2>&1; then
                                  DOCKER_CMD="sudo docker"
                                else
                                  echo "Docker is not available for user ${DEPLOY_USER} on ${DEPLOY_HOST}."
                                  exit 1
                                fi
                                gunzip -c /tmp/${RELEASE}-${IMAGE_TAG}.tar.gz | \$DOCKER_CMD load
                                \$DOCKER_CMD push ${IMAGE_REPO}:${IMAGE_TAG}
                                rm -f /tmp/${RELEASE}-${IMAGE_TAG}.tar.gz
                              '
                              rm -f /tmp/${RELEASE}-${IMAGE_TAG}.tar.gz
                            """
                        }
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
            cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)
        }
    }
}
