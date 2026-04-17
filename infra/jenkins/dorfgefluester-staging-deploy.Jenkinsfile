pipeline {
  agent { label 'linux-docker' }

  options {
    buildDiscarder(logRotator(daysToKeepStr: '7', numToKeepStr: '10', artifactDaysToKeepStr: '7', artifactNumToKeepStr: '5'))
    timestamps()
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
  }

  parameters {
    string(name: 'IMAGE_TAG', defaultValue: '', description: 'Image tag to deploy (optional). If empty, deploys branch alias tag (e.g. master-latest).')
    string(name: 'BRANCH', defaultValue: 'master', description: 'Source branch for this deploy (informational)')
    string(name: 'APP_HOST', defaultValue: 'dev-env-01', description: 'Ingress host for staging (optional)')
    string(name: 'APP_PATH', defaultValue: '/dorfgefluester', description: 'Ingress path prefix for staging')
    string(name: 'CHART_PATH', defaultValue: 'infra/helm/dorfgefluester', description: 'Path to Helm chart in this repo')
  booleanParam(name: 'RUN_SYNTHETICS', defaultValue: true, description: 'Run Playwright synthetic browser checks against deployed staging')
  booleanParam(name: 'RUN_SIGNOZ_GATE', defaultValue: false, description: 'Query SigNoz runtime metrics after staging deploy')
  string(name: 'SIGNOZ_BASE_URL', defaultValue: 'http://signoz:8080', description: 'Base URL for the SigNoz instance')
  string(name: 'SIGNOZ_SERVICE_NAME', defaultValue: 'dorfgefluester-web', description: 'OpenTelemetry service.name to evaluate in SigNoz')
  string(name: 'SIGNOZ_DEPLOYMENT_ENVIRONMENT', defaultValue: 'staging', description: 'OpenTelemetry deployment.environment.name to evaluate in SigNoz')
  string(name: 'SIGNOZ_API_KEY_CREDENTIAL_ID', defaultValue: '', description: 'Jenkins Secret Text credential ID holding the SigNoz API key')
    string(name: 'SIGNOZ_LOOKBACK_MINUTES', defaultValue: '15', description: 'How far back to query SigNoz after synthetic checks')
    string(name: 'SIGNOZ_MAX_ERROR_RATE', defaultValue: '0.05', description: 'Maximum allowed error-rate ratio from SigNoz (for example 0.05 = 5%)')
    string(name: 'SIGNOZ_MIN_REQUEST_RATE', defaultValue: '0.01', description: 'Minimum observed request rate required to trust the SigNoz gate')
    booleanParam(name: 'RUN_DAST', defaultValue: true, description: 'Run OWASP ZAP baseline scan against deployed staging')
    booleanParam(name: 'RUN_K6', defaultValue: true, description: 'Run k6 smoke load test against deployed staging')
  }

  environment {
    DEPLOY_HOST = 'dev-env-01'
    DEPLOY_USER = 'deploy'
    SSH_CRED_ID = 'deploy'
    APP_NAME = 'dorfgefluester'
    K8S_NAMESPACE = 'dorfgefluester'
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
            def branch = params.BRANCH?.trim()
            if (!branch) {
              branch = 'master'
            }
            if (branch == 'master') {
              requestedTag = 'master-latest'
            } else if (branch == 'staging') {
              requestedTag = 'staging-latest'
            } else {
              error("IMAGE_TAG not provided and BRANCH='${branch}' is not supported. Provide IMAGE_TAG or use BRANCH=master|staging.")
            }
            echo "IMAGE_TAG not provided; using branch alias tag '${requestedTag}' (BRANCH=${branch})."
          }
          if (!requestedTag || requestedTag == 'null') {
            error('Unable to resolve IMAGE_TAG from parameter or SCM revision.')
          }
          env.IMAGE_TAG = requestedTag
          env.IMAGE_PULL_POLICY = requestedTag.endsWith('-latest') ? 'Always' : 'IfNotPresent'
          env.ROLLOUT_NONCE = requestedTag.endsWith('-latest') ? "${env.BUILD_TAG ?: env.BUILD_NUMBER}" : ''
          if (!fileExists(params.CHART_PATH)) {
            error("Helm chart not found at ${params.CHART_PATH}. Adjust CHART_PATH.")
          }
          if (!fileExists("${params.CHART_PATH}/values-staging.yaml")) {
            error("Missing ${params.CHART_PATH}/values-staging.yaml. The deploy chart must expose a staging values contract for GitOps/Jenkins parity.")
          }
        }
      }
    }

    stage('Preflight (k3s)') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
            ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
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
        sh """
          set -e
          for image in ${WEB_IMAGE_NAME} ${API_IMAGE_NAME}; do
            url="http://${REGISTRY_HOST}/v2/\${image}/tags/list"
            attempts=30
            sleep_secs=20
            found=0
            for i in \$(seq 1 \$attempts); do
              if tags_json=\$(curl -fsS "\$url" 2>/dev/null); then
                if echo "\$tags_json" | grep -q '"${IMAGE_TAG}"'; then
                  echo "OK: tag ${IMAGE_TAG} found in \$image"
                  found=1
                  break
                fi
              fi
              echo "Tag ${IMAGE_TAG} not found in \$image (attempt \$i/\$attempts)."
              if [ "\$i" -lt "\$attempts" ]; then sleep "\$sleep_secs"; fi
            done
            if [ "\$found" = "0" ]; then
              echo "Available tags for \$image:"; curl -fsS "\$url" || true
              echo "ERROR: image tag ${IMAGE_TAG} not found in \$image after waiting."
              exit 1
            fi
          done
          echo "OK: image tag ${IMAGE_TAG} verified in ${WEB_IMAGE_REPO} and ${API_IMAGE_REPO}"
        """
      }
    }

    stage('Deploy (Helm)') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
            # Ensure the chart path on the target is clean; otherwise scp -r may nest the directory and leave stale files behind.
            ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} 'rm -rf /tmp/dorfgefluester-chart && mkdir -p /tmp/dorfgefluester-chart'
            scp -i "$SSH_KEY" -o StrictHostKeyChecking=no -r ${CHART_PATH}/* ${DEPLOY_USER}@${DEPLOY_HOST}:/tmp/dorfgefluester-chart/

            ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
              set -e
              if k3s kubectl get ns kube-system >/dev/null 2>&1; then
                K3S_CMD="k3s"
              elif sudo -n k3s kubectl get ns kube-system >/dev/null 2>&1; then
                K3S_CMD="sudo -n k3s"
              else
                echo "ERROR: k3s kubectl is not accessible for user ${DEPLOY_USER} (no passwordless sudo)."
                exit 1
              fi

              HELM_BIN=""
              if [ -x /usr/local/bin/helm ]; then
                HELM_BIN="/usr/local/bin/helm"
              elif [ -x /snap/bin/helm ]; then
                HELM_BIN="/snap/bin/helm"
              elif command -v helm >/dev/null 2>&1; then
                HELM_BIN="\$(command -v helm)"
              fi
              if [ -z "\$HELM_BIN" ]; then
                echo "ERROR: helm not found on ${DEPLOY_HOST} for user ${DEPLOY_USER}."
                exit 1
              fi

              HELM_MODE=""
              if "\$HELM_BIN" --kubeconfig /etc/rancher/k3s/k3s.yaml list -n kube-system >/dev/null 2>&1; then
                  HELM_MODE="direct"
              fi

              if [ -z "\$HELM_MODE" ]; then
                if sudo -n sh -lc "\"\$HELM_BIN\" --kubeconfig /etc/rancher/k3s/k3s.yaml list -n kube-system >/dev/null 2>&1"; then
                    HELM_MODE="sudo"
                else
                  echo "ERROR: helm is installed but not accessible under sudo for ${DEPLOY_USER}."
                  echo "       If helm is installed via snap, ensure sudo PATH includes /snap/bin or allow /snap/bin/helm."
                  echo "       Suggested fix: create /usr/local/bin/helm symlink to /snap/bin/helm and update sudoers if needed."
                  exit 1
                fi
              fi

              \$K3S_CMD kubectl get ns ${K8S_NAMESPACE} >/dev/null 2>&1 || \$K3S_CMD kubectl create ns ${K8S_NAMESPACE}
              if ! \$K3S_CMD kubectl -n ${K8S_NAMESPACE} get secret dorfgefluester-postgres >/dev/null 2>&1; then
                echo "INFO: creating dorfgefluester-postgres secret in namespace ${K8S_NAMESPACE} (staging defaults)."
                \$K3S_CMD kubectl -n ${K8S_NAMESPACE} create secret generic dorfgefluester-postgres \
                  --from-literal=postgres-db=dorfgefluester \
                  --from-literal=postgres-user=dorfgefluester \
                  --from-literal=postgres-password=dorfgefluester-staging
              fi
              echo "INFO: adopting existing resources into Helm (idempotent)."
              for resource_type in configmap deployment statefulset service ingress serviceaccount; do
                for name in \$(\$K3S_CMD kubectl -n ${K8S_NAMESPACE} get "\$resource_type" -o name 2>/dev/null | grep "dorfgefluester"); do
                  \$K3S_CMD kubectl -n ${K8S_NAMESPACE} annotate "\$name" \
                    "meta.helm.sh/release-name=${APP_NAME}" \
                    "meta.helm.sh/release-namespace=${K8S_NAMESPACE}" \
                    --overwrite 2>/dev/null || true
                  \$K3S_CMD kubectl -n ${K8S_NAMESPACE} label "\$name" \
                    "app.kubernetes.io/managed-by=Helm" \
                    --overwrite 2>/dev/null || true
                done
              done
              HELM_FLAGS="--kubeconfig /etc/rancher/k3s/k3s.yaml"
              HELM_SET_ARGS="--set web.image.repository=${WEB_IMAGE_REPO} --set web.image.tag=${IMAGE_TAG} --set web.image.pullPolicy=${IMAGE_PULL_POLICY} --set api.image.repository=${API_IMAGE_REPO} --set api.image.tag=${IMAGE_TAG} --set api.image.pullPolicy=${IMAGE_PULL_POLICY} --set api.env.appOrigin=http://${APP_HOST}"
              if [ -n "${APP_HOST}" ]; then
                HELM_SET_ARGS="\$HELM_SET_ARGS --set ingress.host=${APP_HOST}"
              fi
              if [ -n "${APP_PATH}" ]; then
                HELM_SET_ARGS="\$HELM_SET_ARGS --set ingress.path=${APP_PATH}"
              fi
              HELM_SUBCMD="upgrade --install ${APP_NAME} /tmp/dorfgefluester-chart -n ${K8S_NAMESPACE} -f /tmp/dorfgefluester-chart/values.yaml -f /tmp/dorfgefluester-chart/values-staging.yaml \$HELM_SET_ARGS"
              if [ -n "${ROLLOUT_NONCE}" ]; then
                HELM_SUBCMD="\$HELM_SUBCMD --set-string rolloutNonce=${ROLLOUT_NONCE}"
              fi
              if [ "\$HELM_MODE" = "direct" ]; then
                "\$HELM_BIN" \$HELM_FLAGS \$HELM_SUBCMD
              else
                sudo -n sh -lc "\"\$HELM_BIN\" \$HELM_FLAGS \$HELM_SUBCMD"
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
            ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
              set -e
              if k3s kubectl get ns kube-system >/dev/null 2>&1; then
                K3S_CMD="k3s"
              elif sudo -n k3s kubectl get ns kube-system >/dev/null 2>&1; then
                K3S_CMD="sudo -n k3s"
              else
                echo "ERROR: k3s kubectl is not accessible for user ${DEPLOY_USER} (no passwordless sudo)."
                exit 1
              fi

              rollout_ok=1
              for workload in deploy/${APP_NAME}-web deploy/${APP_NAME}-api; do
                if ! \$K3S_CMD kubectl -n ${K8S_NAMESPACE} rollout status "\$workload" --timeout=180s; then
                  rollout_ok=0
                fi
              done
              if \$K3S_CMD kubectl -n ${K8S_NAMESPACE} get statefulset/${APP_NAME}-postgres >/dev/null 2>&1; then
                if ! \$K3S_CMD kubectl -n ${K8S_NAMESPACE} rollout status statefulset/${APP_NAME}-postgres --timeout=180s; then
                  rollout_ok=0
                fi
              fi
              if [ "\$rollout_ok" = "0" ]; then
                echo "WARN: rollout status timed out; collecting deployment diagnostics before HTTP verification."
                echo "== Deployments =="
                \$K3S_CMD kubectl -n ${K8S_NAMESPACE} get deploy,statefulset -l app=${APP_NAME} -o wide || true
                echo "== ReplicaSets =="
                \$K3S_CMD kubectl -n ${K8S_NAMESPACE} get rs -l app=${APP_NAME} -o wide || true
                echo "== Pods =="
                \$K3S_CMD kubectl -n ${K8S_NAMESPACE} get pods -l app=${APP_NAME} -o wide || true
                echo "== Pod Descriptions =="
                \$K3S_CMD kubectl -n ${K8S_NAMESPACE} describe pods -l app=${APP_NAME} || true
                echo "== Recent Events =="
                \$K3S_CMD kubectl -n ${K8S_NAMESPACE} get events --sort-by=.metadata.creationTimestamp | tail -n 40 || true
              fi

              target_url="http://${DEPLOY_HOST}${APP_PATH}/"
              api_url="http://${DEPLOY_HOST}/api/health"
              host_header=""
              if [ -n "${APP_HOST}" ]; then
                host_header="Host: ${APP_HOST}"
              fi
              attempts=12
              sleep_secs=5
              for i in \$(seq 1 \$attempts); do
                status_code=\$(curl -sS -o /tmp/dorfgefluester-verify-body -D /tmp/dorfgefluester-verify-headers -w "%{http_code}" \${host_header:+-H "\$host_header"} "\$target_url" || true)
                api_status=\$(curl -sS -o /tmp/dorfgefluester-api-verify-body -D /tmp/dorfgefluester-api-verify-headers -w "%{http_code}" \${host_header:+-H "\$host_header"} "\$api_url" || true)
                if [ "\$status_code" = "200" ] && [ "\$api_status" = "200" ]; then
                  if [ -n "${APP_HOST}" ]; then
                    echo "OK: \$target_url and \$api_url (Host: ${APP_HOST})"
                  else
                    echo "OK: \$target_url and \$api_url"
                  fi
                  exit 0
                fi
                echo "Verify attempt \$i/\$attempts returned HTTP \$status_code for \$target_url and HTTP \$api_status for \$api_url"
                if [ "\$i" -lt "\$attempts" ]; then
                  sleep "\$sleep_secs"
                fi
              done
              if [ "\$rollout_ok" = "0" ]; then
                echo "ERROR: rollout status did not complete and HTTP verification never reached 200 for \$target_url"
              fi
              echo "ERROR: staging ingress did not become ready in time for \$target_url"
              echo "== Response headers =="
              cat /tmp/dorfgefluester-verify-headers || true
              echo "== Response body =="
              cat /tmp/dorfgefluester-verify-body || true
              exit 1
            '
          """
        }
      }
    }

    stage('Post-Deploy Smoke') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
          sh """
            ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
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

    stage('Synthetic Journeys (Playwright)') {
      when { expression { return params.RUN_SYNTHETICS == true } }
      steps {
        script {
          sh 'mkdir -p reports/playwright "$WORKSPACE@tmp/.npm-cache"'
          def targetUrl = "http://${env.DEPLOY_HOST}${params.APP_PATH}/"
          def installStatus = sh(
            script: '''
              set -e
              if [ ! -f package-lock.json ]; then
                echo "ERROR: package-lock.json is required for staging synthetic checks."
                exit 1
              fi
              docker run --rm -u "$(id -u):$(id -g)" \
                -e CI=true \
                -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
                -e npm_config_cache=/work-tmp/.npm-cache \
                -v "$WORKSPACE:/work" \
                -v "$WORKSPACE@tmp:/work-tmp" \
                -w /work \
                node:20 \
                sh -lc 'npm ci --prefer-offline --no-audit'
            ''',
            returnStatus: true
          )

          if (installStatus != 0) {
            unstable("Skipping staging synthetics: npm ci failed while preparing Playwright dependencies (exit ${installStatus}).")
            return
          }

          def playwrightVersion = sh(
            script: '''
              set -e
              docker run --rm -u "$(id -u):$(id -g)" \
                -v "$WORKSPACE:/work" -w /work \
                node:20 \
                sh -lc '
                  if [ -f node_modules/@playwright/test/package.json ]; then
                    node -p "require(\\"./node_modules/@playwright/test/package.json\\").version"
                  elif [ -f package-lock.json ]; then
                    node -e "const lock=require(\\"./package-lock.json\\"); const v=(lock?.packages?.[\\"node_modules/@playwright/test\\"]?.version)|| (lock?.dependencies?.[\\"@playwright/test\\"]?.version) || \\"\\"; process.stdout.write(v);"
                  else
                    echo ""
                  fi
                '
            ''',
            returnStdout: true
          ).trim()

          if (!playwrightVersion) {
            unstable('Skipping staging synthetics: unable to resolve @playwright/test version from node_modules or package-lock.json.')
            return
          }

          def playwrightImage = "mcr.microsoft.com/playwright:v${playwrightVersion}-jammy"
          def hostHeaderArg = params.APP_HOST?.trim() ? "-e PLAYWRIGHT_HOST_HEADER='${params.APP_HOST.trim()}'" : ''
          def status = sh(
            script: """
              docker run --rm --ipc=host \
                -u "\$(id -u):\$(id -g)" \
                -e CI=true \
                -e PLAYWRIGHT_SKIP_WEBSERVER=true \
                -e PLAYWRIGHT_BASE_URL="${targetUrl}" \
                 ${hostHeaderArg} \
                 -v "${env.WORKSPACE}:/work" \
                 -w /work \
                 ${playwrightImage} \
                 bash -lc 'npx playwright test tests/e2e/staging-health.spec.js tests/e2e/staging-account-smoke.spec.js --project=chromium'
             """,
             returnStatus: true
           )

          sh '''
            if [ -f reports/playwright/staging-health-summary.txt ]; then
              echo "===== Staging Synthetic Health Summary ====="
              cat reports/playwright/staging-health-summary.txt
              echo "===== End Staging Synthetic Health Summary ====="
            else
              echo "No staging health summary file produced."
            fi
          '''

          if (status != 0) {
            unstable("Synthetic staging journeys found issues (exit ${status}). See reports/playwright, playwright-report, and tests/test-results artifacts.")
          }
        }
      }
      post {
        always {
          archiveArtifacts artifacts: 'reports/playwright/**/*,playwright-report/**/*,tests/test-results/**/*', fingerprint: true, allowEmptyArchive: true
        }
      }
    }

    stage('SigNoz Runtime Gate') {
      when { expression { return params.RUN_SIGNOZ_GATE == true } }
      steps {
        script {
      sh 'mkdir -p reports/signoz'

      def baseUrl = params.SIGNOZ_BASE_URL?.trim()
      def serviceName = params.SIGNOZ_SERVICE_NAME?.trim()
      def deploymentEnvironment = params.SIGNOZ_DEPLOYMENT_ENVIRONMENT?.trim()
      def telemetryScope = deploymentEnvironment ? "${serviceName} (${deploymentEnvironment})" : serviceName
      def credentialId = params.SIGNOZ_API_KEY_CREDENTIAL_ID?.trim()
      def lookbackMinutes = (params.SIGNOZ_LOOKBACK_MINUTES?.trim() ?: '15') as Integer
      def maxErrorRate = (params.SIGNOZ_MAX_ERROR_RATE?.trim() ?: '0.05') as BigDecimal
      def minRequestRate = (params.SIGNOZ_MIN_REQUEST_RATE?.trim() ?: '0.01') as BigDecimal

      if (!baseUrl || !serviceName || !credentialId) {
        unstable('Skipping SigNoz runtime gate: SIGNOZ_BASE_URL, SIGNOZ_SERVICE_NAME, and SIGNOZ_API_KEY_CREDENTIAL_ID must be configured.')
        return
          }

          def endTime = System.currentTimeMillis()
          def startTime = endTime - (lookbackMinutes * 60L * 1000L)
          def sanitizedBaseUrl = baseUrl.replaceAll('/+$', '')
          def slurper = new groovy.json.JsonSlurperClassic()

          def normalizeMetricValues
          normalizeMetricValues = { Object node ->
            if (node == null) {
              return []
            }
            if (node instanceof Number) {
              return [node as Double]
            }
            if (node instanceof CharSequence) {
              def text = node.toString().trim()
              return text.isNumber() ? [text as Double] : []
            }
            if (node instanceof List) {
              if (node.size() == 2) {
                return normalizeMetricValues(node[1])
              }
              return node.collectMany { item -> normalizeMetricValues(item) }
            }
            return []
          }

          def extractMetricValues
          extractMetricValues = { Object node ->
            if (node == null) {
              return []
            }
            if (node instanceof Map) {
              def values = []
              ['value', 'values'].each { key ->
                if (node.containsKey(key)) {
                  values += normalizeMetricValues(node[key])
                }
              }
              ['data', 'result', 'series', 'list'].each { key ->
                if (node.containsKey(key)) {
                  values += extractMetricValues(node[key])
                }
              }
              return values
            }
            if (node instanceof List) {
              return node.collectMany { item -> extractMetricValues(item) }
            }
            return []
          }

          def buildPayload = { String filterExpression ->
            [
              start         : startTime,
              end           : endTime,
              requestType   : 'time_series',
              compositeQuery: [
                queries: [[
                  type: 'builder_query',
                  spec: [
                    name        : 'A',
                    signal      : 'metrics',
                    stepInterval: 60,
                    aggregations: [[
                      metricName      : 'signoz_calls_total',
                      timeAggregation : 'rate',
                      spaceAggregation: 'sum'
                    ]],
                    filter      : [
                      expression: filterExpression
                    ],
                    disabled    : false
                  ]
                ]]
              ]
            ]
          }

          withCredentials([string(credentialsId: credentialId, variable: 'SIGNOZ_API_KEY')]) {
            def querySigNoz = { String name, Map payload ->
              def payloadPath = "reports/signoz/${name}-payload.json"
              def responsePath = "reports/signoz/${name}-response.json"
              writeFile file: payloadPath, text: groovy.json.JsonOutput.prettyPrint(groovy.json.JsonOutput.toJson(payload))
              def status = sh(
                script: """
                  curl -fsS -X POST '${sanitizedBaseUrl}/api/v5/query_range' \
                    -H 'Content-Type: application/json' \
                    -H "SIGNOZ-API-KEY: \$SIGNOZ_API_KEY" \
                    --data @'${payloadPath}' \
                    -o '${responsePath}'
                """,
                returnStatus: true
              )

              if (status != 0) {
                unstable("SigNoz runtime gate query '${name}' failed (exit ${status}). See reports/signoz/${name}-payload.json for the request.")
                return null
              }

              return slurper.parseText(readFile(responsePath))
            }

          def totalFilter = "service.name = '${serviceName}'"
          if (deploymentEnvironment) {
            totalFilter = "${totalFilter} AND deployment.environment.name = '${deploymentEnvironment}'"
          }
          def errorFilter = "${totalFilter} AND status.code = 'STATUS_CODE_ERROR'"
            def totalResponse = querySigNoz('total-rate', buildPayload(totalFilter))
            def errorResponse = querySigNoz('error-rate', buildPayload(errorFilter))

            if (totalResponse == null || errorResponse == null) {
              return
            }

            def totalValues = extractMetricValues(totalResponse).findAll { it != null }
            def errorValues = extractMetricValues(errorResponse).findAll { it != null }
            def peakTotalRate = totalValues ? totalValues.max() : 0.0d
            def peakErrorRate = errorValues ? errorValues.max() : 0.0d
            def derivedErrorRatio = peakTotalRate > 0 ? (peakErrorRate / peakTotalRate) : 0.0d
            def summary = [
              serviceName           : serviceName,
              deploymentEnvironment : deploymentEnvironment,
              telemetryScope        : telemetryScope,
              lookbackMinutes       : lookbackMinutes,
              peakTotalRate         : peakTotalRate,
              peakErrorRate         : peakErrorRate,
              derivedErrorRatio     : derivedErrorRatio,
              maxAllowedError       : maxErrorRate as Double,
              minRequestRate        : minRequestRate as Double,
              queriedAt             : new Date(endTime).format("yyyy-MM-dd'T'HH:mm:ssXXX", TimeZone.getTimeZone('UTC'))
            ]

            writeFile file: 'reports/signoz/runtime-gate-summary.json', text: groovy.json.JsonOutput.prettyPrint(groovy.json.JsonOutput.toJson(summary))
            echo "SigNoz runtime gate summary: ${groovy.json.JsonOutput.toJson(summary)}"

            if (!totalValues) {
              unstable("SigNoz runtime gate found no request metrics for service '${serviceName}' in the last ${lookbackMinutes} minutes.")
              return
            }

            if (peakTotalRate < (minRequestRate as Double)) {
              unstable("SigNoz runtime gate saw insufficient traffic for service '${serviceName}' (peak rate ${String.format('%.4f', peakTotalRate)} req/s, expected at least ${minRequestRate}).")
            }

            if (derivedErrorRatio > (maxErrorRate as Double)) {
              unstable("SigNoz runtime gate exceeded error-rate threshold for ${telemetryScope} (${String.format('%.4f', derivedErrorRatio)} > ${maxErrorRate}).")
            }
          }
        }
      }
      post {
        always {
          archiveArtifacts artifacts: 'reports/signoz/**/*', fingerprint: true, allowEmptyArchive: true
        }
      }
    }

    stage('DAST (OWASP ZAP Baseline)') {
      when { expression { return params.RUN_DAST == true } }
      steps {
        script {
          sh 'mkdir -p reports/zap'
          def targetUrl = "http://${env.DEPLOY_HOST}${params.APP_PATH}/"
          def status = sh(
            script: """
              docker run --rm -u "\$(id -u):\$(id -g)" \
                -v "${env.WORKSPACE}:/zap/wrk" \
                ghcr.io/zaproxy/zaproxy:stable \
                zap-baseline.py -t "${targetUrl}" \
                  -c jenkins/zap-baseline-int.conf \
                  -r reports/zap/zap-baseline.html \
                  -w reports/zap/zap-baseline.md \
                  -x reports/zap/zap-baseline.xml \
                  -J reports/zap/zap-baseline.json
            """,
            returnStatus: true
          )
          sh 'sed -n \'1,200p\' reports/zap/zap-baseline.md || true'
          if (status != 0) {
            unstable("OWASP ZAP baseline found issues (exit ${status}). See reports/zap/ artifacts.")
          }
        }
      }
    }

    stage('Load Test (k6)') {
      when { expression { return params.RUN_K6 == true } }
      steps {
        script {
          sh 'mkdir -p reports/k6'
          def targetUrl = "http://${env.DEPLOY_HOST}${params.APP_PATH}/"
          def status = sh(
            script: """
              docker run --rm -u "\$(id -u):\$(id -g)" \
                -e TARGET_URL="${targetUrl}" \
                -v "${env.WORKSPACE}:/work" -w /work \
                grafana/k6:latest run \
                  --summary-export reports/k6/summary.json \
                  tests/k6/staging-smoke.js
            """,
            returnStatus: true
          )
          if (status != 0) {
            unstable("k6 thresholds failed (exit ${status}). See reports/k6/summary.json")
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
    success {
      // Keep deployment host tidy without touching active images/containers.
      withCredentials([sshUserPrivateKey(credentialsId: env.SSH_CRED_ID, keyFileVariable: 'SSH_KEY')]) {
        sh """
          ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no ${DEPLOY_USER}@${DEPLOY_HOST} '
            set +e
            if command -v docker >/dev/null 2>&1; then
              docker image prune -f --filter "dangling=true" || true
            fi
          '
        """
      }
    }
  }
}
