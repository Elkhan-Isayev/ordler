{{- define "ordler.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ordler.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "ordler.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{ include "ordler.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "ordler.selectorLabels" -}}
app.kubernetes.io/name: {{ include "ordler.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Install-page mode: no database in values, settings live in the data volume. */}}
{{- define "ordler.installerMode" -}}
{{- if not .Values.database.host -}}true{{- end -}}
{{- end -}}

{{- define "ordler.secretName" -}}
{{- printf "%s-secrets" (include "ordler.fullname" .) -}}
{{- end -}}

{{- define "ordler.dbSecretName" -}}
{{- default (include "ordler.secretName" .) .Values.database.existingSecret -}}
{{- end -}}

{{- define "ordler.keySecretName" -}}
{{- default (include "ordler.secretName" .) .Values.encryptionKey.existingSecret -}}
{{- end -}}
