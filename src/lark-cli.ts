import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { AppConfig } from "./config.js";

const execAsync = promisify(exec);

export interface CLIExecuteResult {
  success: boolean;
  data?: any;
  error?: string;
  rawOutput?: string;
  retryCount?: number;
  executionTime?: number;
}

export interface CLIOperation {
  command: string;
  args: string[];
  description: string;
  requiresConfirmation: boolean;
}

interface CacheEntry {
  data: any;
  timestamp: number;
}

export class LarkCLIExecutor {
  private readonly cliPath: string;
  private readonly timeout: number;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTTL = {
    calendar: 5 * 60 * 1000,    // 5分钟
    contact: 30 * 60 * 1000,    // 30分钟
    docs: 10 * 60 * 1000,       // 10分钟
    approval: 2 * 60 * 1000,    // 2分钟
    task: 5 * 60 * 1000,        // 5分钟
  };
  private readonly maxCacheSize = 100;

  constructor(private readonly config: AppConfig) {
    this.cliPath = config.larkCliPath || "D:\\Feishu\\cli\\lark-cli.cmd";
    this.timeout = config.cliTimeout || 30000;
    
    // 定期清理过期缓存
    setInterval(() => this.cleanExpiredCache(), 60 * 1000); // 每分钟清理一次
  }

  private getCacheKey(command: string, args: string[]): string {
    return `${command}:${args.join(':')}`;
  }

  private getFromCache(key: string, ttl: number): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const now = Date.now();
    if (now - entry.timestamp > ttl) {
      this.cache.delete(key);
      return null;
    }
    
    console.log(`[lark-cli] Cache hit: ${key}`);
    return entry.data;
  }

  private setCache(key: string, data: any): void {
    // LRU: 如果缓存满了，删除最旧的
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  private cleanExpiredCache(): void {
    const now = Date.now();
    const maxTTL = Math.max(...Object.values(this.cacheTTL));
    
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > maxTTL) {
        this.cache.delete(key);
      }
    }
  }

  clearCache(): void {
    this.cache.clear();
    console.log('[lark-cli] Cache cleared');
  }

  /**
   * 清除特定类型的缓存
   */
  clearCacheByType(type: 'calendar' | 'contact' | 'docs' | 'approval' | 'task'): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(type + ':')) {
        this.cache.delete(key);
        count++;
      }
    }
    console.log(`[lark-cli] Cleared ${count} cache entries of type: ${type}`);
    return count;
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats(): {
    total: number;
    byType: Record<string, number>;
    sizeKB: number;
  } {
    const byType: Record<string, number> = {};
    let totalSize = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      const type = key.split(':')[0] || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
      
      // 估算大小（粗略）
      try {
        totalSize += JSON.stringify(entry.data).length;
      } catch {
        totalSize += 100;
      }
    }

    return {
      total: this.cache.size,
      byType,
      sizeKB: Math.round(totalSize / 1024 * 100) / 100,
    };
  }

  /**
   * 格式化缓存统计为可读文本
   */
  formatCacheStats(): string {
    const stats = this.getCacheStats();
    
    if (stats.total === 0) {
      return "💾 缓存为空";
    }

    const typeLines = Object.entries(stats.byType)
      .map(([type, count]) => `  • ${type}: ${count} 项`)
      .join('\n');

    return `💾 缓存统计：\n\n📊 总计：${stats.total} 项\n💿 大小：${stats.sizeKB} KB\n\n📁 按类型分类：\n${typeLines}`;
  }

  /**
   * 执行lark-cli命令（带重试机制）
   */
  async execute(
    command: string, 
    args: string[] = [], 
    options: { format?: string; maxRetries?: number; retryDelay?: number } = {}
  ): Promise<CLIExecuteResult> {
    const maxRetries = options.maxRetries ?? 3;
    const baseRetryDelay = options.retryDelay ?? 1000;
    const startTime = Date.now();
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const format = options.format || "json";
        const argsWithFormat = [...args];
        
        // 如果没有指定format参数，添加--format json
        if (format === "json" && !args.some(arg => arg.includes("--format"))) {
          argsWithFormat.push("--format", "json");
        }

        const cmdString = `"${this.cliPath}" ${command} ${argsWithFormat.join(" ")}`;
        
        if (attempt > 0) {
          console.log(`[lark-cli] Retry attempt ${attempt}/${maxRetries}: ${cmdString}`);
        } else {
          console.log(`[lark-cli] Executing: ${cmdString}`);
        }

        const { stdout, stderr } = await execAsync(cmdString, {
          timeout: this.timeout,
          maxBuffer: 1024 * 1024 * 10, // 10MB
        });

        if (stderr && !stdout) {
          throw new Error(stderr);
        }

        // 尝试解析JSON
        let data: any;
        try {
          data = JSON.parse(stdout);
        } catch {
          // 如果不是JSON，返回原始文本
          data = stdout;
        }

        const executionTime = Date.now() - startTime;
        console.log(`[lark-cli] Success in ${executionTime}ms (attempt ${attempt + 1})`);

        return {
          success: true,
          data,
          rawOutput: stdout,
          retryCount: attempt,
          executionTime,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isLastAttempt = attempt === maxRetries;
        
        // 判断是否应该重试
        const shouldRetry = this.shouldRetryError(errorMsg) && !isLastAttempt;
        
        if (shouldRetry) {
          // 指数退避：1s, 2s, 4s...
          const delay = baseRetryDelay * Math.pow(2, attempt);
          console.warn(`[lark-cli] Attempt ${attempt + 1} failed: ${errorMsg}. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error(`[lark-cli] Execution failed after ${attempt + 1} attempts: ${errorMsg}`);
          return {
            success: false,
            error: this.formatUserFriendlyError(errorMsg),
            retryCount: attempt,
            executionTime: Date.now() - startTime,
          };
        }
      }
    }
    
    // 不应该到达这里
    return {
      success: false,
      error: "执行失败：未知错误",
      retryCount: maxRetries,
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * 判断错误是否应该重试
   */
  private shouldRetryError(errorMsg: string): boolean {
    const retryableErrors = [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'timeout',
      'network',
      'rate limit',
      '429',
      '503',
      '504',
    ];
    
    const lowerError = errorMsg.toLowerCase();
    return retryableErrors.some(pattern => lowerError.includes(pattern.toLowerCase()));
  }

  /**
   * 格式化用户友好的错误信息
   */
  private formatUserFriendlyError(errorMsg: string): string {
    const lowerError = errorMsg.toLowerCase();
    
    if (lowerError.includes('timeout')) {
      return '⏱️ 操作超时，请稍后重试';
    }
    if (lowerError.includes('network') || lowerError.includes('econnrefused')) {
      return '🌐 网络连接失败，请检查网络';
    }
    if (lowerError.includes('permission') || lowerError.includes('403')) {
      return '🔒 权限不足，请检查应用权限配置';
    }
    if (lowerError.includes('not found') || lowerError.includes('404')) {
      return '❓ 未找到相关资源';
    }
    if (lowerError.includes('rate limit') || lowerError.includes('429')) {
      return '⚠️ 请求过于频繁，请稍后再试';
    }
    if (lowerError.includes('invalid') || lowerError.includes('400')) {
      return '❌ 请求参数有误';
    }
    
    // 返回原始错误，但限制长度
    return errorMsg.length > 100 ? errorMsg.substring(0, 100) + '...' : errorMsg;
  }

  /**
   * 判断操作是否需要确认
   */
  isConfirmationRequired(command: string, subcommand?: string): boolean {
    const confirmActions = this.config.cliConfirmActions || ["create", "update", "delete", "send", "approve"];
    
    // 检查子命令是否在确认列表中
    if (subcommand && confirmActions.some(action => subcommand.includes(action))) {
      return true;
    }

    // 检查命令本身
    if (confirmActions.some(action => command.includes(action))) {
      return true;
    }

    return false;
  }

  // ==================== 日历操作 ====================

  /**
   * 查看日程（带缓存）
   */
  async getAgenda(days: number = 1): Promise<CLIExecuteResult> {
    const cacheKey = this.getCacheKey("calendar", ["+agenda", String(days)]);
    const cached = this.getFromCache(cacheKey, this.cacheTTL.calendar);
    
    if (cached) {
      return { success: true, data: cached };
    }
    
    const result = await this.execute("calendar", ["+agenda"]);
    if (result.success && result.data) {
      this.setCache(cacheKey, result.data);
    }
    
    return result;
  }

  /**
   * 查看日历事件
   */
  async listCalendarEvents(params: {
    calendarId?: string;
    startTime?: number;
    endTime?: number;
  }): Promise<CLIExecuteResult> {
    const calendarId = params.calendarId || "primary";
    const args = ["events", "instance_view"];
    
    const queryParams: Record<string, any> = {
      calendar_id: calendarId,
    };

    if (params.startTime) {
      queryParams.start_time = Math.floor(params.startTime / 1000).toString();
    }
    if (params.endTime) {
      queryParams.end_time = Math.floor(params.endTime / 1000).toString();
    }

    args.push("--params", JSON.stringify(queryParams));
    return this.execute("calendar", args);
  }

  /**
   * 创建日历事件
   */
  async createCalendarEvent(params: {
    summary: string;
    startTime: number;
    endTime: number;
    description?: string;
    location?: string;
  }): Promise<CLIExecuteResult> {
    const data = {
      summary: params.summary,
      start_time: {
        timestamp: Math.floor(params.startTime / 1000).toString(),
      },
      end_time: {
        timestamp: Math.floor(params.endTime / 1000).toString(),
      },
      ...(params.description ? { description: params.description } : {}),
      ...(params.location ? { location: { name: params.location } } : {}),
    };

    return this.execute("calendar", ["events", "create", "--data", JSON.stringify(data)]);
  }

  // ==================== 联系人操作 ====================

  /**
   * 搜索用户（带缓存）
   */
  async searchUser(query: string): Promise<CLIExecuteResult> {
    const cacheKey = this.getCacheKey("contact", ["+search-user", query]);
    const cached = this.getFromCache(cacheKey, this.cacheTTL.contact);
    
    if (cached) {
      return { success: true, data: cached };
    }
    
    const result = await this.execute("contact", ["+search-user", "--query", query]);
    if (result.success && result.data) {
      this.setCache(cacheKey, result.data);
    }
    
    return result;
  }

  /**
   * 获取用户信息（带缓存）
   */
  async getUserInfo(userId: string): Promise<CLIExecuteResult> {
    const cacheKey = this.getCacheKey("contact", ["users", "get", userId]);
    const cached = this.getFromCache(cacheKey, this.cacheTTL.contact);
    
    if (cached) {
      return { success: true, data: cached };
    }
    
    const result = await this.execute("contact", ["users", "get", "--params", JSON.stringify({ user_id: userId })]);
    if (result.success && result.data) {
      this.setCache(cacheKey, result.data);
    }
    
    return result;
  }

  // ==================== 文档操作 ====================

  /**
   * 搜索文档（带缓存）
   */
  async searchDocs(query: string): Promise<CLIExecuteResult> {
    const cacheKey = this.getCacheKey("docs", ["search", query]);
    const cached = this.getFromCache(cacheKey, this.cacheTTL.docs);
    
    if (cached) {
      return { success: true, data: cached };
    }
    
    const result = await this.execute("docs", ["search", "--query", query]);
    if (result.success && result.data) {
      this.setCache(cacheKey, result.data);
    }
    
    return result;
  }

  /**
   * 创建文档
   */
  async createDoc(params: { title: string; content?: string }): Promise<CLIExecuteResult> {
    const data = {
      title: params.title,
      ...(params.content ? { content: params.content } : {}),
    };
    return this.execute("docs", ["create", "--data", JSON.stringify(data)]);
  }

  // ==================== 审批操作 ====================

  /**
   * 查看待审批（带缓存）
   */
  async listApprovals(params?: { status?: string }): Promise<CLIExecuteResult> {
    const args = ["instance", "list"];
    if (params?.status) {
      args.push("--params", JSON.stringify({ status: params.status }));
    }
    
    const cacheKey = this.getCacheKey("approval", args);
    const cached = this.getFromCache(cacheKey, this.cacheTTL.approval);
    
    if (cached) {
      return { success: true, data: cached };
    }
    
    const result = await this.execute("approval", args);
    if (result.success && result.data) {
      this.setCache(cacheKey, result.data);
    }
    
    return result;
  }

  /**
   * 审批通过/拒绝
   */
  async approveInstance(instanceId: string, approved: boolean, comment?: string): Promise<CLIExecuteResult> {
    const data = {
      approval_code: instanceId,
      approval_result: approved ? "APPROVE" : "REJECT",
      ...(comment ? { comment } : {}),
    };
    return this.execute("approval", ["instance", "approve", "--data", JSON.stringify(data)]);
  }

  // ==================== 任务操作 ====================

  /**
   * 查看任务列表（带缓存）
   */
  async listTasks(): Promise<CLIExecuteResult> {
    const cacheKey = this.getCacheKey("task", ["list"]);
    const cached = this.getFromCache(cacheKey, this.cacheTTL.task);
    
    if (cached) {
      return { success: true, data: cached };
    }
    
    const result = await this.execute("task", ["list"]);
    if (result.success && result.data) {
      this.setCache(cacheKey, result.data);
    }
    
    return result;
  }

  /**
   * 创建任务
   */
  async createTask(params: {
    summary: string;
    description?: string;
    dueTime?: number;
  }): Promise<CLIExecuteResult> {
    const data = {
      summary: params.summary,
      ...(params.description ? { description: params.description } : {}),
      ...(params.dueTime ? { due: { timestamp: Math.floor(params.dueTime / 1000).toString() } } : {}),
    };
    return this.execute("task", ["create", "--data", JSON.stringify(data)]);
  }

  // ==================== 消息操作 ====================

  /**
   * 发送消息
   */
  async sendMessage(params: {
    receiveId: string;
    msgType: string;
    content: string;
  }): Promise<CLIExecuteResult> {
    const data = {
      receive_id: params.receiveId,
      msg_type: params.msgType,
      content: params.content,
    };
    return this.execute("im", ["messages", "create", "--data", JSON.stringify(data)]);
  }

  // ==================== 通用API调用 ====================

  /**
   * 通用API调用
   */
  async apiCall(method: string, path: string, params?: any, data?: any): Promise<CLIExecuteResult> {
    const args = ["api", method, path];
    
    if (params) {
      args.push("--params", JSON.stringify(params));
    }
    
    if (data) {
      args.push("--data", JSON.stringify(data));
    }

    return this.execute("", args);
  }
}
