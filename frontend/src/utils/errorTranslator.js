export const translateJobError = (job) => {
    if (!job) return '未知错误';
    const code = job.error_code || '';
    const msg = job.error_message || '';

    if (code === 'quota_exceeded' || msg.includes('429')) {
        return 'API 限额已耗尽，请稍后再试或更换 API Key。';
    }
    if (code === 'invalid_request' || msg.includes('400')) {
        return '解析请求被拒绝 (400)，可能是由于内容过长、包含敏感信息或格式异常。';
    }
    if (msg.toLowerCase().includes('timeout')) {
        return '解析超时，可能是 AI 服务响应过慢，请稍后重试。';
    }
    if (msg.toLowerCase().includes('socket hang up') || msg.toLowerCase().includes('econnreset')) {
        return '网络连接中断，请检查网络或 AI 服务状态。';
    }
    return msg || '解析过程中发生未知错误';
};
