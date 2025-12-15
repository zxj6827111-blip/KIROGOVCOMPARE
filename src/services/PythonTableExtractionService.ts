import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { Warning } from '../types/models';

export interface PythonExtractionResult {
  success: boolean;
  tables?: any[];
  warnings: Warning[];
  error?: string;
  metrics?: {
    elapsedMs: number;
    confidence: number;
    issues: string[];
  };
}

export class PythonTableExtractionService {
  /**
   * 调用 Python 脚本提取表格
   * 支持超时控制和错误处理
   */
  async extractTablesFromPdf(
    pdfPath: string,
    schemaPath: string,
    timeoutMs: number = 180000
  ): Promise<PythonExtractionResult> {
    const warnings: Warning[] = [];
    const startTime = Date.now();

    return new Promise((resolve) => {
      try {
        // 验证文件存在
        if (!fs.existsSync(pdfPath)) {
          return resolve({
            success: false,
            warnings,
            error: `PDF 文件不存在: ${pdfPath}`,
          });
        }

        if (!fs.existsSync(schemaPath)) {
          return resolve({
            success: false,
            warnings,
            error: `Schema 文件不存在: ${schemaPath}`,
          });
        }

        const pythonScript = path.join(__dirname, '../../python/extract_tables_pdfplumber_v2.py');
        if (!fs.existsSync(pythonScript)) {
          return resolve({
            success: false,
            warnings,
            error: `Python 脚本不存在: ${pythonScript}`,
          });
        }

        console.log(`[PythonTableExtractionService] 启动 Python 表格提取`);
        console.log(`  PDF: ${pdfPath}`);
        console.log(`  Schema: ${schemaPath}`);
        console.log(`  超时: ${timeoutMs}ms`);

        // 启动 Python 子进程
        const pythonProcess = spawn('python3', [
          pythonScript,
          pdfPath,
          '--schema',
          schemaPath,
          '--out',
          '-',  // 输出到 stdout
        ]);

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        // 设置超时
        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          console.error('[PythonTableExtractionService] Python 进程超时，正在杀死...');
          pythonProcess.kill('SIGKILL');
        }, timeoutMs);

        // 收集 stdout
        pythonProcess.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        // 收集 stderr
        pythonProcess.stderr?.on('data', (data) => {
          stderr += data.toString();
          console.error(`[PythonTableExtractionService] stderr: ${data}`);
        });

        // 处理进程结束
        pythonProcess.on('close', (code) => {
          clearTimeout(timeoutHandle);
          const elapsedMs = Date.now() - startTime;

          if (timedOut) {
            return resolve({
              success: false,
              warnings,
              error: `Python 进程超时 (${timeoutMs}ms)`,
              metrics: {
                elapsedMs,
                confidence: 0,
                issues: ['进程超时'],
              },
            });
          }

          if (code !== 0) {
            console.error(`[PythonTableExtractionService] Python 进程异常退出，code=${code}`);
            console.error(`stderr: ${stderr}`);
            return resolve({
              success: false,
              warnings,
              error: `Python 进程异常: ${stderr || `exit code ${code}`}`,
              metrics: {
                elapsedMs,
                confidence: 0,
                issues: [stderr || `exit code ${code}`],
              },
            });
          }

          try {
            // 解析 JSON 输出
            const result = JSON.parse(stdout);
            console.log(`[PythonTableExtractionService] 提取成功，耗时 ${elapsedMs}ms`);
            console.log(`  表格数: ${result.tables?.length || 0}`);

            return resolve({
              success: true,
              tables: result.tables || [],
              warnings,
              metrics: {
                elapsedMs,
                confidence: result.confidence || 0.5,
                issues: result.issues || [],
              },
            });
          } catch (parseError) {
            console.error('[PythonTableExtractionService] JSON 解析失败:', parseError);
            console.error(`stdout: ${stdout.substring(0, 500)}`);
            return resolve({
              success: false,
              warnings,
              error: `JSON 解析失败: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
              metrics: {
                elapsedMs,
                confidence: 0,
                issues: ['JSON 解析失败'],
              },
            });
          }
        });

        // 处理进程错误
        pythonProcess.on('error', (err) => {
          clearTimeout(timeoutHandle);
          const elapsedMs = Date.now() - startTime;
          console.error('[PythonTableExtractionService] 进程启动失败:', err);
          resolve({
            success: false,
            warnings,
            error: `进程启动失败: ${err.message}`,
            metrics: {
              elapsedMs,
              confidence: 0,
              issues: [err.message],
            },
          });
        });
      } catch (error) {
        const elapsedMs = Date.now() - startTime;
        console.error('[PythonTableExtractionService] 异常:', error);
        resolve({
          success: false,
          warnings,
          error: `异常: ${error instanceof Error ? error.message : String(error)}`,
          metrics: {
            elapsedMs,
            confidence: 0,
            issues: [error instanceof Error ? error.message : String(error)],
          },
        });
      }
    });
  }
}

export default new PythonTableExtractionService();
