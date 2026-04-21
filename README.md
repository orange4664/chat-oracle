# Chat Oracle

ChatGPT 镜像 Web 界面，基于 [Oracle](https://github.com/steipete/oracle) 实现。

## 功能

- 类 ChatGPT 深色主题聊天界面
- 发送消息、上传文件附件
- 会话管理：新建 / 继续对话
- 支持指定 GPT 项目 URL
- 简单密码保护
- 支持远程模式（Oracle serve）和本地模式（Oracle browser）

## 快速开始

```bash
git clone https://github.com/orange4664/chat-oracle.git
cd chat-oracle
npm install
cp .env.example .env
# 编辑 .env 填入你的配置
npm start
```

打开 http://localhost:3000，输入密码即可使用。

## 部署模式

### 远程模式（推荐）

连接到已运行的 Oracle serve 实例：

```env
ORACLE_MODE=remote
ORACLE_REMOTE_HOST=your-server:3080
ORACLE_REMOTE_TOKEN=your-token
```

需要先在本地或服务器上启动 Oracle serve：

```bash
oracle serve --port 3080 --token your-token
```

### 本地模式

直接在本机运行 Oracle 浏览器自动化：

```env
ORACLE_MODE=local
```

需要本机安装 Chrome 并已登录 ChatGPT。

## 配置说明

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PASSWORD` | 登录密码 | `chat123` |
| `ORACLE_MODE` | 运行模式 (`remote` / `local`) | `remote` |
| `ORACLE_REMOTE_HOST` | Oracle serve 地址 | - |
| `ORACLE_REMOTE_TOKEN` | Oracle serve 认证令牌 | - |
| `ORACLE_DEFAULT_PROJECT` | 默认 GPT 项目 URL | - |
| `PORT` | Web 服务端口 | `3000` |

## GPT 项目支持

在侧边栏的 "GPT Project URL" 输入框填入项目地址（如 `https://chatgpt.com/g/g-p-xxx/project`），后续新对话将在该项目内创建。

## 技术栈

- Express.js + multer（后端）
- 原生 HTML/CSS/JS（前端，无框架）
- Oracle CLI（ChatGPT 浏览器自动化）
