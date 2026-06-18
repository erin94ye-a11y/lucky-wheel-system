# 活动转盘抽奖系统

这是一个可部署到 Railway 的转盘抽奖系统。前台和后台已经拆成两个独立服务：

- 前台抽奖服务：面向参与用户，只显示抽奖入口。
- 后台管理服务：只建议在本地启动，用账号密码登录后管理抽奖码、奖品、概率、图片和记录。

## 功能

- 前台输入抽奖代码后参与抽奖。
- 抽奖结果由服务器计算，前端只负责展示动画。
- 后台可自主生成抽奖代码，也可手动填写抽奖代码。
- 后台可设置奖品、上传奖品图片、配置概率权重和库存。
- 后台可查看参与记录，包括抽奖代码、中奖结果、服务器可见 IP、转发 IP、浏览器信息和时间。
- 初始后台账号：`admin`
- 初始后台密码：`admin`

## 本地运行

安装依赖：

```bash
npm install
```

只启动前台：

```bash
npm start
```

打开前台：

```text
http://localhost:3000
```

只启动本地后台：

```bash
npm run start:admin
```

打开后台：

```text
http://127.0.0.1:3001
```

同时启动前台和本地后台：

```bash
npm run start:local
```

默认地址：

- 前台：`http://localhost:3000`
- 后台：`http://127.0.0.1:3001`

后台服务默认只监听 `127.0.0.1`，也就是只允许本机访问。

## Railway 部署

Railway 部署建议只部署前台服务。后台请在本地启动后管理本地数据库；如果你需要管理 Railway 上的线上数据库，需要额外设计远程后台访问方案。

1. 在 Railway 中选择这个 GitHub 仓库部署。
2. 添加以下环境变量：

```bash
ADMIN_USER=admin
ADMIN_PASSWORD=admin
SESSION_SECRET=请改成一串很长的随机字符串
DATABASE_PATH=/data/app.db
UPLOAD_DIR=/data/uploads
```

3. 在 Railway 中添加 Volume，并挂载到 `/data`。  
   SQLite 数据库和上传图片都建议放在这个持久化目录下。

4. 部署完成后访问 Railway 给出的域名。这个线上服务默认只提供前台抽奖页面，不提供后台入口。

## 生产环境注意事项

- 上线前请修改 `ADMIN_PASSWORD` 和 `SESSION_SECRET`。
- 如果不挂载 Railway Volume，数据库和上传图片可能会在重新部署后丢失。
- 系统记录的是服务器或可信代理能看到的 IP，以及 `X-Forwarded-For` 转发 IP。它不能绕过 VPN、代理、运营商 NAT 或浏览器隐私保护来识别绝对物理 IP。
- 前台页面已提示用户参与抽奖会记录服务器可见 IP 和浏览器信息，建议根据你的活动规则补充隐私说明。

## 常用命令

```bash
npm test
npm start
npm run start:admin
npm run start:local
```
