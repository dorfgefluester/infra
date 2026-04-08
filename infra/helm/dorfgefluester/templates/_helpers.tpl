{{- define "dorfgefluester.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dorfgefluester.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- include "dorfgefluester.name" . -}}
{{- end -}}
{{- end -}}

{{- define "dorfgefluester.isMonolith" -}}
{{- if eq .Values.deploymentMode "monolith" -}}true{{- else -}}false{{- end -}}
{{- end -}}

{{- define "dorfgefluester.labels" -}}
app.kubernetes.io/name: {{ include "dorfgefluester.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end -}}

{{- define "dorfgefluester.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dorfgefluester.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "dorfgefluester.webName" -}}
{{- if eq .Values.deploymentMode "monolith" -}}
{{- include "dorfgefluester.fullname" . -}}
{{- else -}}
{{- printf "%s-web" (include "dorfgefluester.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "dorfgefluester.apiName" -}}
{{- if eq .Values.deploymentMode "monolith" -}}
{{- include "dorfgefluester.fullname" . -}}
{{- else -}}
{{- printf "%s-api" (include "dorfgefluester.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "dorfgefluester.postgresName" -}}
{{- printf "%s-postgres" (include "dorfgefluester.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dorfgefluester.redisName" -}}
{{- printf "%s-redis" (include "dorfgefluester.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dorfgefluester.workerName" -}}
{{- printf "%s-worker" (include "dorfgefluester.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dorfgefluester.middlewareName" -}}
{{- printf "%s-strip-prefix" (include "dorfgefluester.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dorfgefluester.monolithConfigName" -}}
{{- printf "%s-nginx" (include "dorfgefluester.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
