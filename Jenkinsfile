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
    }

    environment {
        PROJECT_NAME = 'dorfgefluester'
        NODE_MAJOR_REQUIRED = '18'
        BUILD_ALLOWED = 'true'
        REGISTRY = 'dev-env-01:5000'
        IMAGE_REPO = "${REGISTRY}/dorfgefluester"
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
                        def latest = ''
                        withCredentials([gitUsernamePassword(credentialsId: credId, gitToolName: 'Default')]) {
                            latest = sh(
                                script: 'git ls-remote --heads origin | awk \'{print $2}\' | sed \'s#refs/heads/##\' | grep -E \'^[0-9]+\\.[0-9]+\\.[0-9]+$\' | sort -V | tail -n 1',
                                returnStdout: true
                            ).trim()
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
                checkout scm
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

        stage('Lint') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                sh 'npm run lint --if-present -- --max-warnings=0'
            }
        }

        stage('Format Check') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
            steps {
                sh 'npm run format:check --if-present'
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

        stage('Helm Lint') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
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
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
            }
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
                sh """
                  set -e
                  docker build -t ${IMAGE_REPO}:${IMAGE_TAG} .
                  docker push ${IMAGE_REPO}:${IMAGE_TAG}
                """
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
