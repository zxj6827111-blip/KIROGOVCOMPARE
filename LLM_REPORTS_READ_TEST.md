# LLM_REPORTS_READ_TEST.sh 使用说明

- 运行前请确保 API 服务启动，并且脚本与服务共用同一个 `SQLITE_DB_PATH`（默认为 `data/llm_dev.db`）。如果服务以环境变量覆盖了路径，执行脚本时也需要传入相同的值：
  ```bash
  SQLITE_DB_PATH=/custom/path/llm_dev.db ./LLM_REPORTS_READ_TEST.sh
  ```
- 脚本优先使用 `python3`，若不存在则回退 `python`；请确保其中之一已安装。
- 其他依赖：`sqlite3` CLI、`curl`。
