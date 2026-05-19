const NETWORK_ERROR_MESSAGE = '服务暂时不可用，请稍后重试。';
const DEFAULT_PARSE_ERROR_MESSAGE = '解析过程遇到问题，请稍后重试或重新提交任务。';

const getPayloadText = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || '';
  if (typeof value === 'object') {
    return [
      value.error_code,
      value.errorCode,
      value.code,
      value.error,
      value.message,
      value.error_message,
      value.errorMessage,
      value.details,
    ]
      .filter(Boolean)
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
      .join(' ');
  }
  return String(value);
};

export const getRawErrorDetail = (input) => {
  if (!input) return '';
  const responseData = input.response?.data;
  const parts = [
    input.error_code,
    input.errorCode,
    input.code,
    input.error,
    input.message,
    input.error_message,
    input.errorMessage,
    responseData?.error_code,
    responseData?.errorCode,
    responseData?.code,
    responseData?.error,
    responseData?.message,
    responseData?.error_message,
    responseData?.errorMessage,
  ].filter(Boolean);

  return parts.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' | ');
};

export const translateFailureReason = (input, fallback = DEFAULT_PARSE_ERROR_MESSAGE) => {
  const responseData = input?.response?.data;
  const status = input?.response?.status;
  const text = [
    getPayloadText(input),
    getPayloadText(responseData),
  ].join(' ');
  const lower = text.toLowerCase();

  if (text.includes('COMPARISON_CONTENT_NOT_READY')) {
    return '比对内容尚未生成完成，请稍后重试或重新生成比对。';
  }

  if (text.includes('Failed to fetch comparison data from backend')) {
    return '无法读取比对内容，请确认比对是否已生成完成。';
  }

  if (
    text.includes('文件过期') ||
    lower.includes('file expired') ||
    lower.includes('expired')
  ) {
    return '文件已过期，请重新生成。';
  }

  const isTransportError = Boolean(input?.isAxiosError || input?.request || input?.response);

  if (
    status >= 500 ||
    (isTransportError && !input?.response) ||
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('network error') ||
    lower.includes('internal server error') ||
    lower.includes('econnreset') ||
    lower.includes('socket hang up') ||
    lower.includes('timeout')
  ) {
    return NETWORK_ERROR_MESSAGE;
  }

  if (lower.includes('429') || lower.includes('quota_exceeded')) {
    return '服务调用额度暂时不可用，请稍后重试或联系管理员处理。';
  }

  if (lower.includes('400') || lower.includes('invalid_request')) {
    return '任务请求未通过校验，请检查文件内容或重新提交。';
  }

  return fallback || getRawErrorDetail(input) || DEFAULT_PARSE_ERROR_MESSAGE;
};

export const translateJobError = (job) => translateFailureReason(job, DEFAULT_PARSE_ERROR_MESSAGE);

export const getAxiosFriendlyError = (error, fallback = NETWORK_ERROR_MESSAGE) => ({
  message: translateFailureReason(error, fallback),
  detail: getRawErrorDetail(error),
});
