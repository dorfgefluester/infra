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
    }

    stages {
        stage('Gate: Latest Version Branch') {
            steps {
                script {
                    def isVersionBranch = (env.BRANCH_NAME ==~ /\\d+\\.\\d+\\.\\d+/)
                    if (isVersionBranch) {
                        def latest = sh(
                            script: "git ls-remote --heads origin | awk '{print $2}' | sed 's#refs/heads/##' | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+$' | sort -V | tail -n 1",
                            returnStdout: true
                        ).trim()
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
                sh 'npm run lint --if-present'
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
                        sh 'npm test -- --ci --coverage=false'
                    }
                }
            }
            post {
                always {
                    junit testResults: 'tests/junit/**/*.xml', allowEmptyResults: true
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
                expression { return env.BUILD_ALLOWED == 'true' && params.RUN_E2E && env.BRANCH_NAME == 'main' }
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
    }

    post {
        always {
            cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)
        }
    }
}
