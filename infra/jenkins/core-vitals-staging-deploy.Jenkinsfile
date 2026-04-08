pipeline {
  agent { label 'linux-docker' }

  options {
    buildDiscarder(logRotator(daysToKeepStr: '7', numToKeepStr: '10', artifactDaysToKeepStr: '7', artifactNumToKeepStr: '5'))
    timestamps()
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
  }

  parameters {
    string(name: 'IMAGE_TAG', defaultValue: '', description: 'Image tag to deploy (git sha or build number)')
    string(name: 'APP_HOST', defaultValue: 'core-vitals-staging.dev-env-01', description: 'Ingress host for staging')
    string(name: 'CHART_PATH', defaultValue: 'helm/core-vitals', description: 'Path to Helm chart in this repo')
  }

  environment {
    DEPLOY_HOST = 'dev-env-01'
    DEPLOY_USER = 'deploy'
    SSH_CRED_ID = 'dev-env-01-ssh'
    APP_NAME = 'core-vitals'
    K8S_NAMESPACE = 'staging'
    REGISTRY_HOST = 'dev-env-01:5000'
    API_IMAGE_NAME = 'core-vitals-api'
    WEB_IMAGE_NAME = 'core-vitals-web'
    WORKERS_IMAGE_NAME = 'core-vitals-workers'
  }

  stages {
    stage('Validate Params') {
      steps {
        script {
          def requestedTag = params.IMAGE_TAG?.trim()
          if (!requestedTag) {
            sh 'git config --global --add safe.directory "$WORKSPACE"'
            requestedTag = env.GIT_COMMIT?.trim()
            if (requestedTag && requestedTag != 'null') {
              requestedTag = requestedTag.take(7)
            }
            if (!requestedTag) {
              requestedTag = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
            }
            echo "IMAGE_TAG not provided; using SCM fallback tag ${requestedTag}."
          }
          if (!requestedTag || requestedTag == 'null') {
            error('Unable to resolve IMAGE_TAG from parameter or SCM revision.')
          }
          env.IMAGE_TAG = requestedTag
          if (!fileExists(params.CHART_PATH)) {
            error("Helm chart not found at ${params.CHART_PATH}. Adjust CHART_PATH.")
          }
        }
      }
    }

    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Preflight (k3s)') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
              set -e
              echo "== Nodes ==" && sudo k3s kubectl get nodes -o wide
              echo "== CoreDNS ==" && sudo k3s kubectl -n kube-system rollout status deploy/coredns --timeout=120s
              echo "== Traefik ==" && sudo k3s kubectl -n kube-system rollout status deploy/traefik --timeout=180s
            '
          """
        }
      }
    }

    stage('Verify IMAGE_TAG Exists In Registry') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
              set -e
              for image in ${API_IMAGE_NAME} ${WEB_IMAGE_NAME} ${WORKERS_IMAGE_NAME}; do
                echo "Checking tag ${IMAGE_TAG} in ${REGISTRY_HOST}/\$image..."
                tags_json=\$(curl -fsS http://${REGISTRY_HOST}/v2/\$image/tags/list)
                echo "\$tags_json" | grep -q "\"${IMAGE_TAG}\"" || {
                  echo "ERROR: image tag ${IMAGE_TAG} not found in ${REGISTRY_HOST}/\$image";
                  exit 1;
                }
                echo "OK: image tag ${IMAGE_TAG} exists in ${REGISTRY_HOST}/\$image"
              done
            '
          """
        }
      }
    }

    stage('Deploy (Helm)') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'rm -rf /tmp/core-vitals-chart'
            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no -r ${CHART_PATH} ${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/core-vitals-chart

            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
              set -e
              if k3s kubectl get ns kube-system >/dev/null 2>&1; then
                K3S_CMD="k3s"
              elif sudo -n k3s kubectl get ns kube-system >/dev/null 2>&1; then
                K3S_CMD="sudo -n k3s"
              else
                echo "ERROR: k3s kubectl is not accessible for user ${DEPLOY_USER} (no passwordless sudo)."
                exit 1
              fi

              if helm list -n kube-system >/dev/null 2>&1; then
                HELM_CMD="helm"
              elif sudo -n helm list -n kube-system >/dev/null 2>&1; then
                HELM_CMD="sudo -n helm"
              else
                echo "ERROR: helm is not accessible for user ${DEPLOY_USER} (no passwordless sudo)."
                exit 1
              fi

              \$K3S_CMD kubectl get ns ${K8S_NAMESPACE} >/dev/null 2>&1 || \$K3S_CMD kubectl create ns ${K8S_NAMESPACE}
              \$HELM_CMD upgrade --install ${APP_NAME} /tmp/core-vitals-chart \
                -n ${K8S_NAMESPACE} \
                --set api.tag=${IMAGE_TAG} \
                --set web.tag=${IMAGE_TAG} \
                --set workers.tag=${IMAGE_TAG} \
                --set ingress.host=${APP_HOST}

              rm -rf /tmp/core-vitals-chart
            '
          """
        }
      }
    }

    stage('Verify') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
              set -e
              sudo k3s kubectl -n ${K8S_NAMESPACE} rollout status deploy/${APP_NAME} --timeout=180s
              curl -fsS -H "Host: ${APP_HOST}" http://${DEPLOY_HOST}/ >/dev/null
              echo "OK: ${APP_HOST}"
            '
          """
        }
      }
    }
  }

  post {
    always {
      sh 'docker image prune -f --filter "dangling=true" || true'
      cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)
    }
  }
}
