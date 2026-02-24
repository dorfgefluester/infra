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
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh 'git rev-parse --short HEAD'
            }
        }

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

        stage('Install') {
            steps {
                sh 'npm ci --prefer-offline --no-audit'
            }
        }

        stage('Lint') {
            steps {
                sh 'npm run lint --if-present'
            }
        }

        stage('Format Check') {
            steps {
                catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                    sh 'npm run format:check --if-present'
                }
            }
        }

        stage('Test') {
            steps {
                sh 'npm test -- --ci --coverage=false'
            }
        }

        stage('E2E (Optional)') {
            when {
                expression { return params.RUN_E2E && env.BRANCH_NAME == 'main' }
            }
            steps {
                sh 'npm run test:e2e'
            }
        }

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
    }

    post {
        always {
            cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)
        }
    }
}
