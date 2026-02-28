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
        DEPLOY_HOST = 'dev-env-01'
        DEPLOY_USER = 'deploy'
        SSH_CRED_ID = 'dev-env-01-ssh'
        NAMESPACE = 'dev'
        RELEASE = 'dorfgefluester'
        JENKINS_URL = 'http://jenkins/'
        STAGING_NAMESPACE = 'staging'
        PROD_NAMESPACE = 'production'
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

        stage('Gate: Latest Version Build Success') {
            when {
                expression { return env.BUILD_ALLOWED == 'true' && env.BRANCH_NAME == 'master' }
            }
            steps {
                script {
                    def credId = scm.userRemoteConfigs[0].credentialsId
                    def latest = ''
                    withCredentials([gitUsernamePassword(credentialsId: credId, gitToolName: 'Default')]) {
                        latest = sh(
                            script: 'git ls-remote --heads origin | awk \'{print $2}\' | sed \'s#refs/heads/##\' | grep -E \'^[0-9]+\\.[0-9]+\\.[0-9]+$\' | sort -V | tail -n 1',
                            returnStdout: true
                        ).trim()
                    }
                    if (!latest) {
                        error('No version branches found; cannot gate master deploy.')
                    }

                    def jobParts = env.JOB_NAME.tokenize('/')
                    if (jobParts.size() < 2) {
                        error("Unexpected JOB_NAME format: ${env.JOB_NAME}")
                    }

                    def rootParts = jobParts[0..-2]
                    def rootPath = rootParts.collect { "job/${it}" }.join('/')
                    def latestPath = (rootParts + [latest]).collect { "job/${it}" }.join('/')
                    def baseUrl = env.JENKINS_URL ?: ''
                    if (!baseUrl) {
                        error('JENKINS_URL is not set; cannot check latest version build status.')
                    }

                    def url = "${baseUrl}${latestPath}/lastBuild/api/json"
                    def jsonText = sh(
                        script: "curl -sf '${url}'",
                        returnStdout: true
                    ).trim()

                    def parsed = new groovy.json.JsonSlurperClassic().parseText(jsonText)
                    def result = (parsed?.result ?: 'UNKNOWN').toString().trim()

                    if (!result) {
                        result = 'UNKNOWN'
                    }

                    if (result != 'SUCCESS') {
                        error("Latest version branch ${latest} build status is ${result}; blocking master deploy.")
                    }

                    echo "Latest version branch ${latest} is SUCCESS; master deploy allowed."
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
                sshagent(credentials: [env.SSH_CRED_ID]) {
                    sh """
                      set -e
                      docker build -t ${IMAGE_REPO}:${IMAGE_TAG} .
                      if docker push ${IMAGE_REPO}:${IMAGE_TAG}; then
                        echo 'Pushed image from Jenkins agent.'
                      else
                        echo 'Direct push failed; falling back to push via ${DEPLOY_HOST}.'
                        docker save ${IMAGE_REPO}:${IMAGE_TAG} | gzip > /tmp/${RELEASE}-${IMAGE_TAG}.tar.gz
                        scp -o StrictHostKeyChecking=no /tmp/${RELEASE}-${IMAGE_TAG}.tar.gz ${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/
                        ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
                          set -e
                          gunzip -c /tmp/${RELEASE}-${IMAGE_TAG}.tar.gz | sudo docker load
                          sudo docker push ${IMAGE_REPO}:${IMAGE_TAG}
                          rm -f /tmp/${RELEASE}-${IMAGE_TAG}.tar.gz
                        '
                        rm -f /tmp/${RELEASE}-${IMAGE_TAG}.tar.gz
                      fi
                    """
                }
            }
        }

        stage('Preflight: k3s ready') {
            agent any
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
                anyOf {
                    branch pattern: '0.*', comparator: 'GLOB'
                    branch 'staging'
                    branch 'master'
                }
            }
            steps {
                sshagent(credentials: [env.SSH_CRED_ID]) {
                    sh """
                        ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
                          set -e

                          echo \"== Nodes ==\"
                          sudo k3s kubectl get nodes -o wide

                          echo \"== Core pods ==\"
                          sudo k3s kubectl -n kube-system get pods -o wide

                          echo \"== Ingress controller ==\"
                          sudo k3s kubectl -n kube-system get deploy traefik
                          sudo k3s kubectl -n kube-system rollout status deploy/traefik --timeout=120s

                          echo \"== DNS ==\"
                          sudo k3s kubectl -n kube-system get deploy coredns
                          sudo k3s kubectl -n kube-system rollout status deploy/coredns --timeout=120s

                          echo \"== Storage class ==\"
                          sudo k3s kubectl get storageclass
                        '
                    """
                }
            }
        }

        stage('Preflight: registry reachable') {
            agent any
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
                anyOf {
                    branch pattern: '0.*', comparator: 'GLOB'
                    branch 'staging'
                    branch 'master'
                }
            }
            steps {
                sshagent(credentials: [env.SSH_CRED_ID]) {
                    sh """
                        ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
                          set -e
                          echo \"== Registry health ==\"
                          curl -fsS http://${DEPLOY_HOST}:5000/v2/ >/dev/null && echo \"Registry OK\"

                          echo \"== k3s registry config ==\"
                          sudo test -f /etc/rancher/k3s/registries.yaml && echo \"registries.yaml OK\" || (echo \"Missing registries.yaml\" && exit 1)
                        '
                    """
                }
            }
        }

        stage('Preflight: image pull test') {
            agent any
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
                    env.IMAGE_TAG = env.IMAGE_TAG ?: sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                }
                sshagent(credentials: [env.SSH_CRED_ID]) {
                    sh """
                        cat <<EOF | ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'sudo k3s kubectl apply -f -'
apiVersion: v1
kind: Pod
metadata:
  name: pulltest
  namespace: dev
spec:
  restartPolicy: Never
  containers:
  - name: c
    image: ${IMAGE_REPO}:${IMAGE_TAG}
    command: [\"sh\",\"-c\",\"echo pulled && sleep 1\"]
EOF
                        ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
                          set -e
                          sudo k3s kubectl -n dev wait --for=condition=Ready pod/pulltest --timeout=120s || true
                          sudo k3s kubectl -n dev describe pod pulltest
                          sudo k3s kubectl -n dev delete pod pulltest --ignore-not-found
                        '
                    """
                }
            }
        }

        stage('Deploy to dev-env-01') {
            agent any
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
                branch pattern: '0.*', comparator: 'GLOB'
            }
            steps {
                script {
                    env.IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                }
                sshagent(credentials: [env.SSH_CRED_ID]) {
                    sh """
                        scp -r helm/dorfgefluester ${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/dorfgefluester-chart

                        ssh -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
                          set -e
                          sudo helm upgrade --install ${RELEASE} /tmp/dorfgefluester-chart \
                            --namespace dev --create-namespace \
                            --set image.repository=${IMAGE_REPO} \
                            --set image.tag=${IMAGE_TAG}
                          sudo k3s kubectl -n dev rollout status deploy/${RELEASE} --timeout=180s
                          sudo k3s kubectl -n dev get pods -o wide
                        '
                    """
                }
            }
        }

        stage('Deploy to Staging') {
            agent any
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
                branch 'staging'
            }
            steps {
                script {
                    env.IMAGE_TAG = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                }
                sshagent(credentials: [env.SSH_CRED_ID]) {
                    sh """
                        scp -r helm/dorfgefluester ${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/dorfgefluester-chart

                        ssh ${DEPLOY_USER}@${DEPLOY_HOST} '
                          set -e
                          sudo helm upgrade --install ${RELEASE} /tmp/dorfgefluester-chart \
                            --namespace ${STAGING_NAMESPACE} --create-namespace \
                            --set image.repository=${IMAGE_REPO} \
                            --set image.tag=${IMAGE_TAG}
                          sudo k3s kubectl -n ${STAGING_NAMESPACE} rollout status deploy/${RELEASE} --timeout=180s
                          sudo k3s kubectl -n ${STAGING_NAMESPACE} get pods -o wide
                        '
                    """
                }
            }
        }

        stage('Deploy to Production') {
            agent any
            when {
                expression { return env.BUILD_ALLOWED == 'true' }
                branch 'master'
            }
            steps {
                input message: "Deploy ${env.IMAGE_TAG ?: 'current build'} to production?", ok: 'Deploy'
                script {
                    env.IMAGE_TAG = env.IMAGE_TAG ?: sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
                }
                sshagent(credentials: [env.SSH_CRED_ID]) {
                    sh """
                        scp -r helm/dorfgefluester ${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/dorfgefluester-chart

                        ssh ${DEPLOY_USER}@${DEPLOY_HOST} '
                          set -e
                          sudo helm upgrade --install ${RELEASE} /tmp/dorfgefluester-chart \
                            --namespace ${PROD_NAMESPACE} --create-namespace \
                            --set image.repository=${IMAGE_REPO} \
                            --set image.tag=${IMAGE_TAG}
                          sudo k3s kubectl -n ${PROD_NAMESPACE} rollout status deploy/${RELEASE} --timeout=180s
                          sudo k3s kubectl -n ${PROD_NAMESPACE} get pods -o wide
                        '
                    """
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
