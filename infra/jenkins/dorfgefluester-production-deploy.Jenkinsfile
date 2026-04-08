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
    string(name: 'APP_HOST', defaultValue: 'dorfgefluester.prod.example.com', description: 'Ingress host for production')
    string(name: 'APP_PATH', defaultValue: '/dorfgefluester', description: 'Ingress path prefix for production')
    string(name: 'CHART_PATH', defaultValue: 'helm/dorfgefluester', description: 'Path to Helm chart in this repo')
  }

  environment {
    DEPLOY_HOST = 'dev-env-01'
    DEPLOY_USER = 'deploy'
    SSH_CRED_ID = 'deploy'
    APP_NAME = 'dorfgefluester'
    K8S_NAMESPACE = 'production'
    REGISTRY_HOST = 'dev-env-01:5000'
    WEB_IMAGE_NAME = 'dorfgefluester'
    WEB_IMAGE_REPO = "${REGISTRY_HOST}/${WEB_IMAGE_NAME}"
    API_IMAGE_NAME = 'dorfgefluester-api'
    API_IMAGE_REPO = "${REGISTRY_HOST}/${API_IMAGE_NAME}"
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

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
          if (!fileExists("${params.CHART_PATH}/values-production.yaml")) {
            error("Missing ${params.CHART_PATH}/values-production.yaml. The deploy chart must expose a production values contract for GitOps/Jenkins parity.")
          }
        }
      }
    }

    stage('Approval Gate (Production)') {
      steps {
        script {
          def confirmation = input(
            message: "Deploy image tag ${env.IMAGE_TAG} to PRODUCTION?",
            ok: 'Approve Production Deploy',
            parameters: [
              string(name: 'CONFIRM_IMAGE_TAG', defaultValue: '', description: 'Type IMAGE_TAG to confirm')
            ]
          )

          if (confirmation?.trim() != env.IMAGE_TAG?.trim()) {
            error("Approval rejected: CONFIRM_IMAGE_TAG must exactly match IMAGE_TAG (${env.IMAGE_TAG}).")
          }
        }
      }
    }

    stage('Preflight (k3s)') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
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
              echo "== Nodes ==" && \$K3S_CMD kubectl get nodes -o wide
              echo "== CoreDNS ==" && \$K3S_CMD kubectl -n kube-system rollout status deploy/coredns --timeout=120s
              echo "== Traefik ==" && \$K3S_CMD kubectl -n kube-system rollout status deploy/traefik --timeout=180s
            '
          """
        }
      }
    }

    stage('Verify IMAGE_TAG Exists In Registry') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
            set -e
            attempts=30
            sleep_secs=20
            for i in \$(seq 1 \$attempts); do
              if ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} "
                set -eu
                for image in ${WEB_IMAGE_NAME} ${API_IMAGE_NAME}; do
                  url='http://${REGISTRY_HOST}/v2/'\\\"\$image\\\"'/tags/list'
                  if ! tags_json=\\\$(curl -fsS \\\"\\\$url\\\"); then
                    echo \\\"ERROR: unable to query registry tags at \\\$url\\\" >&2
                    exit 2
                  fi
                  echo \\\"\\\$tags_json\\\" | grep -q '\\\"${IMAGE_TAG}\\\"' || exit 1
                done
              "; then
                echo "OK: image tag ${IMAGE_TAG} exists in ${WEB_IMAGE_REPO} and ${API_IMAGE_REPO}"
                exit 0
              fi
              echo "Tag ${IMAGE_TAG} not found yet in both image repositories (attempt \$i/\$attempts)."
              if [ "\$i" -lt "\$attempts" ]; then
                sleep "\$sleep_secs"
              fi
            done
            echo "Available tags (registry response):"
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} "for image in ${WEB_IMAGE_NAME} ${API_IMAGE_NAME}; do echo == \$image ==; curl -fsS 'http://${REGISTRY_HOST}/v2/'\"\$image\"'/tags/list' || true; done"
            echo "ERROR: image tag ${IMAGE_TAG} not found in both image repositories after waiting."
            exit 1
          """
        }
      }
    }

    stage('Deploy (Helm)') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'rm -rf /tmp/dorfgefluester-chart && mkdir -p /tmp/dorfgefluester-chart'
            scp -i "${SSH_KEY}" -o StrictHostKeyChecking=no -r ${CHART_PATH}/* ${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/dorfgefluester-chart/

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

              \$K3S_CMD kubectl get ns ${K8S_NAMESPACE} >/dev/null 2>&1 || \$K3S_CMD kubectl create ns ${K8S_NAMESPACE}
              \$K3S_CMD kubectl -n ${K8S_NAMESPACE} get secret dorfgefluester-postgres >/dev/null 2>&1 || {
                echo "ERROR: required secret dorfgefluester-postgres is missing in namespace ${K8S_NAMESPACE}."
                echo "       GitOps/Jenkins deploy expects runtime secrets to exist outside the chart."
                exit 1
              }

              HELM_BIN=""
              if [ -x /usr/local/bin/helm ]; then
                HELM_BIN="/usr/local/bin/helm"
              elif [ -x /snap/bin/helm ]; then
                HELM_BIN="/snap/bin/helm"
              elif command -v helm >/dev/null 2>&1; then
                HELM_BIN="$(command -v helm)"
              fi
              if [ -z "$HELM_BIN" ]; then
                echo "ERROR: helm not found on ${DEPLOY_HOST} for user ${DEPLOY_USER}."
                exit 1
              fi

              HELM_MODE=""
              if "$HELM_BIN" --kubeconfig /etc/rancher/k3s/k3s.yaml list -n kube-system >/dev/null 2>&1; then
                  HELM_MODE="direct"
              fi

              if [ -z "$HELM_MODE" ]; then
                if sudo -n sh -lc "\"$HELM_BIN\" --kubeconfig /etc/rancher/k3s/k3s.yaml list -n kube-system >/dev/null 2>&1"; then
                    HELM_MODE="sudo"
                else
                  echo "ERROR: helm is installed but not accessible under sudo for ${DEPLOY_USER}."
                  echo "       If helm is installed via snap, ensure sudo PATH includes /snap/bin or allow /snap/bin/helm."
                  echo "       Suggested fix: create /usr/local/bin/helm symlink to /snap/bin/helm and update sudoers if needed."
                  exit 1
                fi
              fi

              HELM_FLAGS="--kubeconfig /etc/rancher/k3s/k3s.yaml"
              HELM_SET_ARGS="--set web.image.repository=${WEB_IMAGE_REPO} --set web.image.tag=${IMAGE_TAG} --set api.image.repository=${API_IMAGE_REPO} --set api.image.tag=${IMAGE_TAG} --set api.env.appOrigin=https://${APP_HOST}"
              if [ -n "${APP_HOST}" ]; then
                HELM_SET_ARGS="\$HELM_SET_ARGS --set ingress.host=${APP_HOST}"
              fi
              if [ -n "${APP_PATH}" ]; then
                HELM_SET_ARGS="\$HELM_SET_ARGS --set ingress.path=${APP_PATH}"
              fi
              HELM_SUBCMD="upgrade --install ${APP_NAME} /tmp/dorfgefluester-chart -n ${K8S_NAMESPACE} -f /tmp/dorfgefluester-chart/values.yaml -f /tmp/dorfgefluester-chart/values-production.yaml \$HELM_SET_ARGS"
              if [ "$HELM_MODE" = "direct" ]; then
                "$HELM_BIN" $HELM_FLAGS $HELM_SUBCMD
              else
                sudo -n sh -lc "\"$HELM_BIN\" $HELM_FLAGS $HELM_SUBCMD"
              fi
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
              if k3s kubectl get ns kube-system >/dev/null 2>&1; then
                K3S_CMD="k3s"
              elif sudo -n k3s kubectl get ns kube-system >/dev/null 2>&1; then
                K3S_CMD="sudo -n k3s"
              else
                echo "ERROR: k3s kubectl is not accessible for user ${DEPLOY_USER} (no passwordless sudo)."
                exit 1
              fi
              \$K3S_CMD kubectl -n ${K8S_NAMESPACE} rollout status deploy/${APP_NAME}-web --timeout=180s
              \$K3S_CMD kubectl -n ${K8S_NAMESPACE} rollout status deploy/${APP_NAME}-api --timeout=180s
              if \$K3S_CMD kubectl -n ${K8S_NAMESPACE} get statefulset/${APP_NAME}-postgres >/dev/null 2>&1; then
                \$K3S_CMD kubectl -n ${K8S_NAMESPACE} rollout status statefulset/${APP_NAME}-postgres --timeout=180s
              fi
              if [ -n "${APP_HOST}" ]; then
                curl -fsS -H "Host: ${APP_HOST}" "http://${DEPLOY_HOST}${APP_PATH}/" >/dev/null
                curl -fsS -H "Host: ${APP_HOST}" "http://${DEPLOY_HOST}/api/health" >/dev/null
                echo "OK: http://${DEPLOY_HOST}${APP_PATH}/ (Host: ${APP_HOST})"
              else
                curl -fsS "http://${DEPLOY_HOST}${APP_PATH}/" >/dev/null
                curl -fsS "http://${DEPLOY_HOST}/api/health" >/dev/null
                echo "OK: http://${DEPLOY_HOST}${APP_PATH}/"
              fi
            '
          """
        }
      }
    }

    stage('Post-Deploy Smoke') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
            ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
              set -e
              if [ -n "${APP_HOST}" ]; then
                if ! curl -fsS -H "Host: ${APP_HOST}" "http://${DEPLOY_HOST}${APP_PATH}/healthz" >/dev/null; then
                  curl -fsS -H "Host: ${APP_HOST}" "http://${DEPLOY_HOST}${APP_PATH}/" >/dev/null
                fi
                curl -fsS -H "Host: ${APP_HOST}" "http://${DEPLOY_HOST}/api/health" >/dev/null
                index_html=\$(curl -fsS -H "Host: ${APP_HOST}" "http://${DEPLOY_HOST}${APP_PATH}/")
                asset_path=\$(echo "\$index_html" | grep -oE "assets/[^\\\"]+\\\\.js" | head -n1)
                [ -n "\$asset_path" ] || { echo "ERROR: no JS asset reference found in index HTML"; exit 1; }
                curl -fsS -H "Host: ${APP_HOST}" "http://${DEPLOY_HOST}${APP_PATH}/\$asset_path" >/dev/null
                echo "OK: smoke checks passed for http://${DEPLOY_HOST}${APP_PATH}/ and /api/health (Host: ${APP_HOST}) (\$asset_path)"
              else
                if ! curl -fsS "http://${DEPLOY_HOST}${APP_PATH}/healthz" >/dev/null; then
                  curl -fsS "http://${DEPLOY_HOST}${APP_PATH}/" >/dev/null
                fi
                curl -fsS "http://${DEPLOY_HOST}/api/health" >/dev/null
                index_html=\$(curl -fsS "http://${DEPLOY_HOST}${APP_PATH}/")
                asset_path=\$(echo "\$index_html" | grep -oE "assets/[^\\\"]+\\\\.js" | head -n1)
                [ -n "\$asset_path" ] || { echo "ERROR: no JS asset reference found in index HTML"; exit 1; }
                curl -fsS "http://${DEPLOY_HOST}${APP_PATH}/\$asset_path" >/dev/null
                echo "OK: smoke checks passed for http://${DEPLOY_HOST}${APP_PATH}/ and /api/health (\$asset_path)"
              fi
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
