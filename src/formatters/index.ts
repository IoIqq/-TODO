/**
 * 格式化工具模块
 * 统一处理各类数据的格式化展示
 */

/**
 * 格式化日历结果
 */
export function formatCalendarResult(data: any): string {
  if (!data) return "📅 暂无日程安排";
  
  const events = Array.isArray(data) ? data : (data.items || []);
  if (events.length === 0) return "📅 暂无日程安排";

  const lines = events.slice(0, 10).map((event: any, index: number) => {
    const title = event.summary || event.title || "未命名事件";
    const startTime = event.start_time?.timestamp || event.start?.dateTime || event.start || "";
    const endTime = event.end_time?.timestamp || event.end?.dateTime || event.end || "";
    const location = event.location?.name || event.location || "";
    
    let line = `${index + 1}. **${title}**`;
    if (startTime) line += `\n   ⏰ ${startTime}`;
    if (endTime && endTime !== startTime) line += ` - ${endTime}`;
    if (location) line += `\n   📍 ${location}`;
    
    return line;
  });

  const total = events.length;
  const header = `📅 日程安排（${total}项）：\n\n`;
  const footer = total > 10 ? `\n\n还有 ${total - 10} 项未显示` : "";
  
  return header + lines.join("\n\n") + footer;
}

/**
 * 格式化联系人结果
 */
export function formatContactResult(data: any): string {
  if (!data) return "👤 未找到联系人";
  
  const users = Array.isArray(data) ? data : (data.items || data.users || []);
  if (users.length === 0) return "👤 未找到联系人";

  const lines = users.slice(0, 5).map((user: any) => {
    const name = user.name || user.user_name || "未知";
    const email = user.email || user.enterprise_email || "";
    const mobile = user.mobile || user.phone || "";
    const dept = user.department_name || user.department || "";
    const title = user.job_title || user.title || "";
    
    let line = `👤 **${name}**`;
    if (dept) line += ` - ${dept}`;
    if (title) line += `\n   💼 ${title}`;
    if (email) line += `\n   📧 ${email}`;
    if (mobile) line += `\n   📱 ${mobile}`;
    
    return line;
  });

  const total = users.length;
  const header = `找到 ${total} 个联系人：\n\n`;
  const footer = total > 5 ? `\n\n还有 ${total - 5} 个联系人未显示` : "";
  
  return header + lines.join("\n\n") + footer;
}

/**
 * 格式化文档结果
 */
export function formatDocsResult(data: any): string {
  if (!data) return "📄 未找到文档";
  
  const docs = Array.isArray(data) ? data : (data.items || data.docs || []);
  if (docs.length === 0) return "📄 未找到文档";

  const lines = docs.slice(0, 8).map((doc: any, index: number) => {
    const title = doc.title || doc.name || "未命名文档";
    const url = doc.url || doc.link || "";
    const owner = doc.owner_name || doc.owner || "";
    const updateTime = doc.update_time || doc.modified_time || "";
    
    let line = `${index + 1}. **${title}**`;
    if (owner) line += `\n   👤 ${owner}`;
    if (updateTime) line += `\n   🕐 ${updateTime}`;
    if (url) line += `\n   🔗 ${url}`;
    
    return line;
  });

  const total = docs.length;
  const header = `📄 找到 ${total} 个文档：\n\n`;
  const footer = total > 8 ? `\n\n还有 ${total - 8} 个文档未显示` : "";
  
  return header + lines.join("\n\n") + footer;
}

/**
 * 格式化审批结果
 */
export function formatApprovalResult(data: any): string {
  if (!data) return "✅ 暂无待审批";
  
  const approvals = Array.isArray(data) ? data : (data.items || data.instances || []);
  if (approvals.length === 0) return "✅ 暂无待审批";

  const lines = approvals.slice(0, 8).map((approval: any, index: number) => {
    const title = approval.title || approval.name || "未命名审批";
    const status = approval.status || "待审批";
    const applicant = approval.applicant_name || approval.applicant || "";
    const createTime = approval.create_time || approval.created_at || "";
    
    let line = `${index + 1}. **${title}**`;
    if (applicant) line += `\n   👤 申请人：${applicant}`;
    line += `\n   📊 状态：${status}`;
    if (createTime) line += `\n   🕐 ${createTime}`;
    
    return line;
  });

  const total = approvals.length;
  const header = `✅ 待审批列表（${total}项）：\n\n`;
  const footer = total > 8 ? `\n\n还有 ${total - 8} 项未显示` : "";
  
  return header + lines.join("\n\n") + footer;
}

/**
 * 格式化任务结果
 */
export function formatTaskResult(data: any): string {
  if (!data) return "🎯 暂无任务";
  
  const tasks = Array.isArray(data) ? data : (data.items || data.tasks || []);
  if (tasks.length === 0) return "🎯 暂无任务";

  const lines = tasks.slice(0, 8).map((task: any, index: number) => {
    const title = task.summary || task.title || task.name || "未命名任务";
    const status = task.status || "进行中";
    const due = task.due?.timestamp || task.due_date || task.due || "";
    const assignee = task.assignee_name || task.assignee || "";
    
    let line = `${index + 1}. **${title}**`;
    line += `\n   📊 ${status}`;
    if (due) line += `\n   ⏰ 截止：${due}`;
    if (assignee) line += `\n   👤 ${assignee}`;
    
    return line;
  });

  const total = tasks.length;
  const header = `🎯 任务列表（${total}项）：\n\n`;
  const footer = total > 8 ? `\n\n还有 ${total - 8} 项未显示` : "";
  
  return header + lines.join("\n\n") + footer;
}

/**
 * 通用列表格式化
 * 减少重复代码的辅助函数
 */
export function formatList(params: {
  data: any;
  emptyMessage: string;
  icon: string;
  maxItems: number;
  itemFormatter: (item: any, index: number) => string;
  headerTemplate: (total: number) => string;
}): string {
  const { data, emptyMessage, maxItems, itemFormatter, headerTemplate } = params;
  
  if (!data) return emptyMessage;
  
  const items = Array.isArray(data) ? data : (data.items || []);
  if (items.length === 0) return emptyMessage;

  const lines = items.slice(0, maxItems).map(itemFormatter);
  const total = items.length;
  const header = headerTemplate(total);
  const footer = total > maxItems ? `\n\n还有 ${total - maxItems} 项未显示` : "";
  
  return header + lines.join("\n\n") + footer;
}
