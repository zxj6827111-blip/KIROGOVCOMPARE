import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const API_BASE_URL = 'http://localhost:3000/api/v1';

/**
 * 第三阶段集成测试
 * 测试完整的文件上传、任务创建、处理和结果展示流程
 */
describe('Phase 3 Integration Tests', () => {
  let taskId: string;
  let assetIdA: string;
  let assetIdB: string;

  // 测试用 PDF 文件路径
  const testPdfA = path.join(__dirname, '../../fixtures/sample-report-a.pdf');
  const testPdfB = path.join(__dirname, '../../fixtures/sample-report-b.pdf');

  /**
   * 测试 1: 文件上传功能
   */
  describe('文件上传功能', () => {
    test('应该成功上传两个 PDF 文件并创建任务', async () => {
      // 创建 FormData
      const formData = new FormData();
      formData.append('fileA', fs.createReadStream(testPdfA));
      formData.append('fileB', fs.createReadStream(testPdfB));

      try {
        const response = await axios.post(
          `${API_BASE_URL}/tasks/compare/upload`,
          formData,
          {
            headers: formData.getHeaders(),
            'x-user-id': 'test-user',
          }
        );

        expect(response.status).toBe(201);
        expect(response.data).toHaveProperty('taskId');
        expect(response.data).toHaveProperty('status', 'queued');
        expect(response.data).toHaveProperty('assetIdA');
        expect(response.data).toHaveProperty('assetIdB');

        taskId = response.data.taskId;
        assetIdA = response.data.assetIdA;
        assetIdB = response.data.assetIdB;
      } catch (error) {
        console.error('文件上传失败:', error);
        throw error;
      }
    });

    test('应该拒绝非 PDF 文件', async () => {
      const formData = new FormData();
      formData.append('fileA', Buffer.from('not a pdf'), 'test.txt');
      formData.append('fileB', fs.createReadStream(testPdfB));

      try {
        await axios.post(
          `${API_BASE_URL}/tasks/compare/upload`,
          formData,
          {
            headers: formData.getHeaders(),
            'x-user-id': 'test-user',
          }
        );
        fail('应该抛出错误');
      } catch (error: any) {
        expect(error.response?.status).toBe(400);
      }
    });

    test('应该拒绝缺少文件的请求', async () => {
      const formData = new FormData();
      formData.append('fileA', fs.createReadStream(testPdfA));

      try {
        await axios.post(
          `${API_BASE_URL}/tasks/compare/upload`,
          formData,
          {
            headers: formData.getHeaders(),
            'x-user-id': 'test-user',
          }
        );
        fail('应该抛出错误');
      } catch (error: any) {
        expect(error.response?.status).toBe(400);
      }
    });
  });

  /**
   * 测试 2: 任务查询功能
   */
  describe('任务查询功能', () => {
    test('应该能查询任务状态', async () => {
      const response = await axios.get(`${API_BASE_URL}/tasks/${taskId}`);

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('taskId', taskId);
      expect(response.data).toHaveProperty('status');
      expect(response.data).toHaveProperty('progress');
      expect(response.data).toHaveProperty('stage');
    });

    test('应该能查询任务列表', async () => {
      const response = await axios.get(`${API_BASE_URL}/tasks`, {
        headers: { 'x-user-id': 'test-user' },
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('tasks');
      expect(response.data).toHaveProperty('total');
      expect(Array.isArray(response.data.tasks)).toBe(true);
    });

    test('应该能按状态筛选任务', async () => {
      const response = await axios.get(`${API_BASE_URL}/tasks?status=queued`, {
        headers: { 'x-user-id': 'test-user' },
      });

      expect(response.status).toBe(200);
      expect(Array.isArray(response.data.tasks)).toBe(true);
    });

    test('应该返回 404 对于不存在的任务', async () => {
      try {
        await axios.get(`${API_BASE_URL}/tasks/nonexistent-task-id`);
        fail('应该抛出错误');
      } catch (error: any) {
        expect(error.response?.status).toBe(404);
      }
    });
  });

  /**
   * 测试 3: 任务处理流程
   */
  describe('任务处理流程', () => {
    test('任务应该从 queued 转移到 running', async (done) => {
      // 等待一段时间让任务开始处理
      setTimeout(async () => {
        const response = await axios.get(`${API_BASE_URL}/tasks/${taskId}`);
        
        // 任务可能仍在处理中或已完成
        expect(['running', 'succeeded', 'failed']).toContain(response.data.status);
        done();
      }, 2000);
    });

    test('进度应该单调递增', async (done) => {
      const progressHistory: number[] = [];

      const checkProgress = async () => {
        const response = await axios.get(`${API_BASE_URL}/tasks/${taskId}`);
        progressHistory.push(response.data.progress);

        // 检查单调性
        for (let i = 1; i < progressHistory.length; i++) {
          expect(progressHistory[i]).toBeGreaterThanOrEqual(progressHistory[i - 1]);
        }

        // 如果任务未完成，继续检查
        if (response.data.status !== 'succeeded' && response.data.status !== 'failed') {
          setTimeout(checkProgress, 1000);
        } else {
          // 最终进度应该是 100
          expect(response.data.progress).toBe(100);
          done();
        }
      };

      checkProgress();
    }, 30000); // 30 秒超时
  });

  /**
   * 测试 4: 结果查询功能
   */
  describe('结果查询功能', () => {
    test('完成后应该能查询差异结果', async (done) => {
      // 等待任务完成
      const waitForCompletion = async () => {
        const response = await axios.get(`${API_BASE_URL}/tasks/${taskId}`);

        if (response.data.status === 'succeeded') {
          // 查询差异结果
          const diffResponse = await axios.get(`${API_BASE_URL}/tasks/${taskId}/diff`);
          expect(diffResponse.status).toBe(200);
          expect(diffResponse.data).toHaveProperty('diffResult');
          done();
        } else if (response.data.status === 'failed') {
          fail('任务处理失败');
        } else {
          setTimeout(waitForCompletion, 1000);
        }
      };

      waitForCompletion();
    }, 60000); // 60 秒超时

    test('完成后应该能查询摘要信息', async (done) => {
      const waitForCompletion = async () => {
        const response = await axios.get(`${API_BASE_URL}/tasks/${taskId}`);

        if (response.data.status === 'succeeded') {
          const summaryResponse = await axios.get(`${API_BASE_URL}/tasks/${taskId}/summary`);
          expect(summaryResponse.status).toBe(200);
          expect(summaryResponse.data).toHaveProperty('statistics');
          expect(summaryResponse.data).toHaveProperty('topChangedSections');
          done();
        } else if (response.data.status === 'failed') {
          fail('任务处理失败');
        } else {
          setTimeout(waitForCompletion, 1000);
        }
      };

      waitForCompletion();
    }, 60000);
  });

  /**
   * 测试 5: 任务删除功能
   */
  describe('任务删除功能', () => {
    test('应该能删除任务', async () => {
      // 创建一个新任务用于删除测试
      const formData = new FormData();
      formData.append('fileA', fs.createReadStream(testPdfA));
      formData.append('fileB', fs.createReadStream(testPdfB));

      const createResponse = await axios.post(
        `${API_BASE_URL}/tasks/compare/upload`,
        formData,
        {
          headers: formData.getHeaders(),
          'x-user-id': 'test-user',
        }
      );

      const deleteTaskId = createResponse.data.taskId;

      // 删除任务
      const deleteResponse = await axios.delete(`${API_BASE_URL}/tasks/${deleteTaskId}`);
      expect(deleteResponse.status).toBe(200);
      expect(deleteResponse.data).toHaveProperty('success', true);

      // 验证任务已删除
      try {
        await axios.get(`${API_BASE_URL}/tasks/${deleteTaskId}`);
        fail('应该返回 404');
      } catch (error: any) {
        expect(error.response?.status).toBe(404);
      }
    });
  });

  /**
   * 测试 6: URL 方式创建任务
   */
  describe('URL 方式创建任务', () => {
    test('应该能通过 URL 创建任务', async () => {
      const response = await axios.post(
        `${API_BASE_URL}/tasks/compare/url`,
        {
          urlA: 'https://example.com/report-a.pdf',
          urlB: 'https://example.com/report-b.pdf',
        },
        {
          headers: { 'x-user-id': 'test-user' },
        }
      );

      expect(response.status).toBe(201);
      expect(response.data).toHaveProperty('taskId');
      expect(response.data).toHaveProperty('status', 'queued');
    });

    test('应该拒绝缺少 URL 的请求', async () => {
      try {
        await axios.post(
          `${API_BASE_URL}/tasks/compare/url`,
          {
            urlA: 'https://example.com/report-a.pdf',
          },
          {
            headers: { 'x-user-id': 'test-user' },
          }
        );
        fail('应该抛出错误');
      } catch (error: any) {
        expect(error.response?.status).toBe(400);
      }
    });
  });

  /**
   * 测试 7: 资产方式创建任务
   */
  describe('资产方式创建任务', () => {
    test('应该能通过资产 ID 创建任务', async () => {
      const response = await axios.post(
        `${API_BASE_URL}/tasks/compare/asset`,
        {
          assetIdA,
          assetIdB,
        },
        {
          headers: { 'x-user-id': 'test-user' },
        }
      );

      expect(response.status).toBe(201);
      expect(response.data).toHaveProperty('taskId');
      expect(response.data).toHaveProperty('status', 'queued');
    });

    test('应该拒绝不存在的资产 ID', async () => {
      try {
        await axios.post(
          `${API_BASE_URL}/tasks/compare/asset`,
          {
            assetIdA: 'nonexistent-asset-a',
            assetIdB: 'nonexistent-asset-b',
          },
          {
            headers: { 'x-user-id': 'test-user' },
          }
        );
        fail('应该抛出错误');
      } catch (error: any) {
        expect(error.response?.status).toBe(404);
      }
    });
  });
});
