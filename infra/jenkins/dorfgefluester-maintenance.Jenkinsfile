pipeline {
  agent { label 'linux-docker' }

  parameters {
    booleanParam(name: 'DRY_RUN', defaultValue: false, description: 'Report only, do not prune artifacts')
    string(name: 'ARTIFACT_MAX_AGE_HOURS', defaultValue: '168', description: 'Max age in hours for unused images/containers/networks')
    string(name: 'BUILDKIT_MAX_AGE_HOURS', defaultValue: '336', description: 'Max age in hours for BuildKit cache')
  }

  options {
    buildDiscarder(logRotator(daysToKeepStr: '30', numToKeepStr: '20'))
    disableConcurrentBuilds()
    timestamps()
    timeout(time: 30, unit: 'MINUTES')
    skipDefaultCheckout(true)
  }

  triggers {
    // Weekly cleanup, Sunday around 03:00 (hashed minute per job).
    cron('H 3 * * 0')
  }

  stages {
    stage('Disk Usage Before') {
      steps {
        sh '''
          date -u
          if command -v docker >/dev/null 2>&1; then
            docker --version
            docker system df || true
          else
            echo "Docker not found on this agent."
          fi
          df -h "$WORKSPACE" || true
        '''
      }
    }

    stage('Prune Old Docker Artifacts') {
      steps {
        sh '''
          set +e

          if ! command -v docker >/dev/null 2>&1; then
            echo "Docker not found on this agent. Skipping prune steps."
            exit 0
          fi

          if [ "${DRY_RUN}" = "true" ]; then
            echo "DRY_RUN=true. Planned commands:"
            echo "docker container prune -f --filter until=${ARTIFACT_MAX_AGE_HOURS:-168}h"
            echo "docker image prune -a -f --filter until=${ARTIFACT_MAX_AGE_HOURS:-168}h"
            echo "docker volume prune -f"
            echo "docker builder prune -f --filter until=${BUILDKIT_MAX_AGE_HOURS:-336}h"
            echo "docker network prune -f --filter until=${ARTIFACT_MAX_AGE_HOURS:-168}h"
            docker system df || true
            exit 0
          fi

          ARTIFACT_AGE="${ARTIFACT_MAX_AGE_HOURS:-168}"
          BUILDKIT_AGE="${BUILDKIT_MAX_AGE_HOURS:-336}"

          docker container prune -f --filter "until=${ARTIFACT_AGE}h" || true
          docker image prune -a -f --filter "until=${ARTIFACT_AGE}h" || true
          docker volume prune -f || true
          docker builder prune -f --filter "until=${BUILDKIT_AGE}h" || true
          docker network prune -f --filter "until=${ARTIFACT_AGE}h" || true
        '''
      }
    }

    stage('Disk Usage After') {
      steps {
        sh '''
          if command -v docker >/dev/null 2>&1; then
            docker system df || true
          fi
          df -h "$WORKSPACE" || true
        '''
      }
    }
  }

  post {
    always {
      cleanWs(deleteDirs: true, disableDeferredWipeout: true, notFailBuild: true)
    }
  }
}
