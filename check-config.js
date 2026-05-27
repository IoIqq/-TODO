#!/usr/bin/env node

/**
 * 飞书 Todo 助手配置检查脚本
 * 用于验证所有必需的配置项是否正确设置
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REQUIRED_ENV_VARS = [
  'FEISHU_APP_ID',
  'FEISHU_APP_SECRET',
  'FEISHU_VERIFICATION_TOKEN',
  'FEISHU_TASKLIST_GUID',
];

const OPTIONAL_ENV_VARS = [
  'FEISHU_ENCRYPT_KEY',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'PORT',
  'APP_TIMEZONE',
];

function checkEnvFile() {
  const envPath = path.join(__dirname, '.env');
  
  if (!fs.existsSync(envPath)) {
    console.error('❌ .env 文件不存在');
    console.log('💡 请复制 .env.example 为 .env 并填写配置');
    return false;
  }
  
  console.log('✅ .env 文件存在');
  return true;
}

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    
    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  });
  
  return env;
}

function checkRequiredVars(env) {
  let allPresent = true;
  
  console.log('\n📋 必需配置项检查：');
  REQUIRED_ENV_VARS.forEach(varName => {
    const value = env[varName];
    if (!value || value === 'xxx' || value === 'cli_xxx') {
      console.error(`  ❌ ${varName}: 未配置或使用默认值`);
      allPresent = false;
    } else {
      console.log(`  ✅ ${varName}: ${maskValue(varName, value)}`);
    }
  });
  
  return allPresent;
}

function checkOptionalVars(env) {
  console.log('\n📋 可选配置项：');
  OPTIONAL_ENV_VARS.forEach(varName => {
    const value = env[varName];
    if (!value) {
      console.log(`  ⚪ ${varName}: 未配置（可选）`);
    } else {
      console.log(`  ✅ ${varName}: ${maskValue(varName, value)}`);
    }
  });
}

function maskValue(key, value) {
  if (key.includes('SECRET') || key.includes('TOKEN') || key.includes('KEY')) {
    if (value.length <= 8) {
      return '***';
    }
    return value.substring(0, 4) + '***' + value.substring(value.length - 4);
  }
  return value;
}

function checkTasklistGuid(env) {
  const guid = env.FEISHU_TASKLIST_GUID;
  if (!guid || guid === 'xxx') {
    console.log('\n⚠️  FEISHU_TASKLIST_GUID 未配置');
    console.log('💡 获取方法：');
    console.log('   1. 在飞书中创建一个任务清单');
    console.log('   2. 使用飞书 API 获取清单列表');
    console.log('   3. 将清单的 guid 填入 .env 文件');
    return false;
  }
  
  // 检查是否是有效的 UUID 格式
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(guid)) {
    console.log('\n⚠️  FEISHU_TASKLIST_GUID 格式不正确');
    console.log(`   当前值: ${guid}`);
    console.log('   应该是 UUID 格式，例如: db87dd31-088f-4bb7-b245-d42fc43e7823');
    return false;
  }
  
  return true;
}

function printNextSteps(configOk) {
  console.log('\n' + '='.repeat(60));
  
  if (!configOk) {
    console.log('\n❌ 配置检查未通过，请修复上述问题后重试\n');
    console.log('📖 参考文档：');
    console.log('   - README.md - 项目说明');
    console.log('   - QUICK_START.md - 快速开始');
    console.log('   - 配置飞书回调.md - 飞书配置详细步骤');
    return;
  }
  
  console.log('\n✅ 配置检查通过！\n');
  console.log('📝 下一步操作：\n');
  console.log('1️⃣  启动本地服务：');
  console.log('   npm run dev');
  console.log('   或者 (Windows): .\\start-dev.ps1\n');
  
  console.log('2️⃣  启动公网隧道（二选一）：');
  console.log('   方案 A - Cloudflare Tunnel:');
  console.log('     cloudflared tunnel --url http://localhost:3000');
  console.log('   方案 B - ngrok:');
  console.log('     ngrok http 3000\n');
  
  console.log('3️⃣  配置飞书开放平台：');
  console.log('   - 访问: https://open.feishu.cn/app');
  console.log('   - 找到你的应用');
  console.log('   - 配置事件订阅 URL: https://你的公网地址/feishu/events');
  console.log('   - 配置卡片回调 URL: https://你的公网地址/feishu/events');
  console.log('   - 订阅事件: im.message.receive_v1, card.action.trigger');
  console.log('   - 开通权限: 消息权限 + 任务权限\n');
  
  console.log('4️⃣  测试机器人：');
  console.log('   - 在飞书中搜索并添加你的机器人');
  console.log('   - 发送: 帮助');
  console.log('   - 发送: 明天 3 点 提交周报 p1\n');
  
  console.log('📖 详细配置步骤请查看: 配置飞书回调.md');
}

function main() {
  console.log('🔍 飞书 Todo 助手配置检查\n');
  console.log('='.repeat(60));
  
  if (!checkEnvFile()) {
    printNextSteps(false);
    process.exit(1);
  }
  
  const env = loadEnv();
  const requiredOk = checkRequiredVars(env);
  checkOptionalVars(env);
  
  const tasklistOk = checkTasklistGuid(env);
  
  const configOk = requiredOk && tasklistOk;
  printNextSteps(configOk);
  
  process.exit(configOk ? 0 : 1);
}

main();
