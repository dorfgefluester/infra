pipeline {
    agent { label 'linux-docker' }

    options {
        buildDiscarder(logRotator(daysToKeepStr: '14', numToKeepStr: '10', artifactDaysToKeepStr: '7', artifactNumToKeepStr: '5'))
        timeout(time: 30, unit: 'MINUTES')
        timestamps()
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
    }

    environment {
        REGISTRY = 'dev-env-01:5000'
        IMAGE_REPO = "${REGISTRY}/dorfgefluester"
        API_IMAGE_REPO = "${REGISTRY}/dorfgefluester-api"
        NAMESPACE = 'dev'
        RELEASE = 'dorfgefluester'
    }

    stages {
        stage('Checkout') {
            steps {
                script {
                    for (int attempt = 1; attempt <= 3; attempt++) {
                        try {
                            checkout scm
                            break
                        } catch (err) {
                            if (attempt == 3) throw err
                            echo "Checkout attempt ${attempt} failed: ${err.getMessage()}. Retrying in ${10 * attempt}s..."
                            sleep time: 10 * attempt, unit: 'SECONDS'
                        }
                    }
                }
            }
        }

        stage('Validate') {
            parallel {
                stage('Helm Lint') {
                    steps {
                        script {
                            def hasHelm = sh(script: 'command -v helm >/dev/null 2>&1', returnStatus: true) == 0
                            if (hasHelm) {
                                sh '''
                                  helm lint infra/helm/dorfgefluester
                                  helm lint infra/helm/dorfgefluester -f infra/helm/dorfgefluester/values-staging.yaml
                                '''
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
                                  helm template ${RELEASE} infra/helm/dorfgefluester \
                                    --namespace ${NAMESPACE} \
                                    --set web.image.repository=${IMAGE_REPO} \
                                    --set web.image.tag=ci-dry-run \
                                    --set api.image.repository=${API_IMAGE_REPO} \
                                    --set api.image.tag=ci-dry-run \
                                    --set api.env.appOrigin=http://dorf.test \
                                    --set ingress.host=dorf.test > /tmp/${RELEASE}-rendered.yaml
                                  kubectl apply --dry-run=client -f /tmp/${RELEASE}-rendered.yaml

                                  helm template ${RELEASE}-staging infra/helm/dorfgefluester \
                                    --namespace staging \
                                    -f infra/helm/dorfgefluester/values.yaml \
                                    -f infra/helm/dorfgefluester/values-staging.yaml \
                                    --set web.image.repository=${IMAGE_REPO} \
                                    --set web.image.tag=ci-dry-run \
                                    --set api.image.repository=${API_IMAGE_REPO} \
                                    --set api.image.tag=ci-dry-run \
                                    --set api.env.appOrigin=http://dorf.test \
                                    --set ingress.host=dorf.test > /tmp/${RELEASE}-staging-rendered.yaml
                                  kubectl apply --dry-run=client -f /tmp/${RELEASE}-staging-rendered.yaml
                                """
                            } else {
                                echo 'Helm or kubectl not found on agent; skipping Helm Render (Dry Run).'
                            }
                        }
                    }
                }

                stage('Contract Tests') {
                    steps {
                        catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') {
                            script {
                                def hasPkg = fileExists('package.json')
                                if (!hasPkg) {
                                    echo 'No package.json found in infra repo; skipping contract tests.'
                                    return
                                }
                                sh '''
                                    docker run --rm -u "$(id -u):$(id -g)" \
                                      -v "$WORKSPACE:/work" -w /work \
                                      -e HOME=/tmp \
                                      node:20 \
                                      sh -lc 'npm ci --prefer-offline --no-audit --no-fund && npm test -- --ci'
                                '''
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

        stage('Gitleaks') {
            steps {
                script {
                    sh 'mkdir -p reports/gitleaks'
                    def status = sh(
                        script: '''
                            set -eu
                            TMPDIR="$(mktemp -d)"
                            cleanup() { rm -rf "$TMPDIR"; }
                            trap cleanup EXIT
                            mkdir -p "$TMPDIR/repo" "$WORKSPACE/reports/gitleaks"
                            tar \
                              --exclude='./.git' \
                              --exclude='./reports' \
                              -cf - . | tar -C "$TMPDIR/repo" -xf -
                            docker run --rm -u "$(id -u):$(id -g)" \
                              -v "$TMPDIR/repo:/repo" \
                              -v "$WORKSPACE/reports/gitleaks:/reports" \
                              -w /repo \
                              zricethezav/gitleaks:v8.18.2 detect \
                              --source=/repo \
                              --no-git \
                              --report-format json \
                              --report-path /reports/gitleaks.json \
                              --no-banner
                        ''',
                        returnStatus: true
                    )
                    if (status == 1) {
                        unstable('Gitleaks detected potential secrets. See reports/gitleaks/gitleaks.json')
                    } else if (status != 0) {
                        unstable("Gitleaks execution failed (exit ${status}).")
                    } else {
                        echo 'Gitleaks: no leaks detected.'
                    }
                }
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'reports/**/*', fingerprint: false, allowEmptyArchive: true
            cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)
        }
    }
}
