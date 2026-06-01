/**
 * 操作历史管理模块
 * 记录用户操作，支持重复执行和撤销
 */

import type { IntentAnalysisResult } from "../ai.js";

export interface OperationRecord {
  id: string;
  userId: string;
  timestamp: number;
  type: 'cli' | 'todo' | 'query';
  intent?: IntentAnalysisResult;
  description: string;
  success: boolean;
  canRepeat: boolean;
  canUndo: boolean;
}

export class OperationHistory {
  private readonly maxSize: number;
  private readonly history = new Map<string, OperationRecord[]>();

  constructor(maxSize: number = 10) {
    this.maxSize = maxSize;
  }

  /**
   * 记录操作
   */
  record(userId: string, operation: Omit<OperationRecord, 'id' | 'userId' | 'timestamp'>): void {
    const record: OperationRecord = {
      id: this.generateId(),
      userId,
      timestamp: Date.now(),
      ...operation,
    };

    const userHistory = this.history.get(userId) || [];
    userHistory.unshift(record); // 最新的在前面

    // 限制历史记录数量
    if (userHistory.length > this.maxSize) {
      userHistory.pop();
    }

    this.history.set(userId, userHistory);
    console.log(`[history] Recorded operation for user ${userId}: ${record.description}`);
  }

  /**
   * 获取用户的操作历史
   */
  getHistory(userId: string, limit?: number): OperationRecord[] {
    const userHistory = this.history.get(userId) || [];
    return limit ? userHistory.slice(0, limit) : userHistory;
  }

  /**
   * 获取最后一次操作
   */
  getLastOperation(userId: string): OperationRecord | undefined {
    const userHistory = this.history.get(userId);
    return userHistory && userHistory.length > 0 ? userHistory[0] : undefined;
  }

  /**
   * 获取最后一次可重复的操作
   */
  getLastRepeatableOperation(userId: string): OperationRecord | undefined {
    const userHistory = this.history.get(userId) || [];
    return userHistory.find(op => op.canRepeat && op.success);
  }

  /**
   * 获取最后一次可撤销的操作
   */
  getLastUndoableOperation(userId: string): OperationRecord | undefined {
    const userHistory = this.history.get(userId) || [];
    return userHistory.find(op => op.canUndo && op.success);
  }

  /**
   * 根据ID获取操作
   */
  getOperationById(userId: string, operationId: string): OperationRecord | undefined {
    const userHistory = this.history.get(userId) || [];
    return userHistory.find(op => op.id === operationId);
  }

  /**
   * 清除用户历史
   */
  clearHistory(userId: string): void {
    this.history.delete(userId);
    console.log(`[history] Cleared history for user ${userId}`);
  }

  /**
   * 格式化历史记录为文本
   */
  formatHistory(userId: string, limit: number = 5): string {
    const userHistory = this.getHistory(userId, limit);
    
    if (userHistory.length === 0) {
      return "📝 暂无操作历史";
    }

    const lines = userHistory.map((op, index) => {
      const time = new Date(op.timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      
      const status = op.success ? '✅' : '❌';
      const repeatIcon = op.canRepeat ? '🔄' : '';
      const undoIcon = op.canUndo ? '↩️' : '';
      
      return `${index + 1}. ${status} ${op.description}\n   🕐 ${time} ${repeatIcon}${undoIcon}`;
    });

    const header = `📝 最近操作（${userHistory.length}项）：\n\n`;
    const footer = userHistory.length >= limit ? `\n\n💡 使用 /历史 查看更多` : "";
    
    return header + lines.join("\n\n") + footer;
  }

  /**
   * 获取统计信息
   */
  getStats(userId: string): {
    total: number;
    successful: number;
    failed: number;
    repeatable: number;
    undoable: number;
  } {
    const userHistory = this.history.get(userId) || [];
    
    return {
      total: userHistory.length,
      successful: userHistory.filter(op => op.success).length,
      failed: userHistory.filter(op => !op.success).length,
      repeatable: userHistory.filter(op => op.canRepeat && op.success).length,
      undoable: userHistory.filter(op => op.canUndo && op.success).length,
    };
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
