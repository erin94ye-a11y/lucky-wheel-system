# 活动转盘抽奖系统

这是一个可部署到 Railway 的转盘抽奖系统，包含前台抽奖页面和后台管理页面。

## 功能

- 前台输入抽奖代码后参与抽奖。
- 抽奖结果由服务器计算，前端只负责展示动画。
- 后台可创建抽奖代码、设置奖品、上传奖品图片、配置概率权重和库存。
- 后台可查看参与记录，包括抽奖代码、中奖结果、服务器可见 IP、转发 IP、浏览器信息和时间。
- 初始后台账号：`admin`
- 初始后台密码：`admin`

## 本地运行

```bash
npm install
npm start
```

打开：

- 前台：`http://localhost:3000`
- 后台：`http://localhost:3000/admin.html`

## Railway 部署

1. 将本项目上传到 GitHub。
2. 在 Railway 中选择从 GitHub 仓库部署。
3. 添加以下环境变量：

```bash
ADMIN_USER=admin
ADMIN_PASSWORD=admin
SESSION_SECRET=请改成一串很长的随机字符串
DATABASE_PATH=/data/app.db
UPLOAD_DIR=/data/uploads
```

4. 在 Railway 中添加 Volume，并挂载到 `/data`。  
   SQLite 数据库和上传图片都建议放在这个持久化目录下。

5. 部署完成后访问 Railway 给出的域名，后台入口为 `/admin.html`。

## 生产环境注意事项

- 上线前请修改 `ADMIN_PASSWORD` 和 `SESSION_SECRET`。
- 如果不挂载 Railway Volume，数据库和上传图片可能会在重新部署后丢失。
- 系统记录的是服务器或可信代理能看到的 IP，以及 `X-Forwarded-For` 转发 IP。它不能绕过 VPN、代理、运营商 NAT 或浏览器隐私保护来识别绝对物理 IP。
- 前台页面已提示用户参与抽奖会记录服务器可见 IP 和浏览器信息，建议根据你的活动规则补充隐私说明。

## 常用命令

```bash
npm test
npm start
```
