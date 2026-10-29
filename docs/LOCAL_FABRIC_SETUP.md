# 本机 Fabric 环境与演示复现

本文记录本次实际跑通的 Windows + WSL 环境、需要修改的文件以及已提交的实现。代码在 Windows 仓库中编辑；Docker、Fabric、后端依赖和数据库运行在 WSL。首次安装与日常启动分开执行，已有环境直接看第 4 节。

## 1. 主要实现与入口

| 仓库文件 | 作用 |
| --- | --- |
| `blockchain/chaincode/src/fairpass.ts` 及同目录文件 | 已有的活动、抽签、领票、转让、核销、票权索引与操作历史链码；此前已提交 |
| `backend/src/fabric/real-gateway-adapter.ts` | 本次新增的真实 Gateway：TLS、证书签名、背书、提交、等待 commit 确认、按交易 ID 获取操作记录 |
| `backend/src/fabric/create-gateway-adapter.ts` | 按 `FABRIC_GATEWAY_MODE` 选择真实或 Mock 实现 |
| `backend/src/fabric/types.ts`、`backend/src/server.ts` | 连接关闭接口及服务退出时释放连接 |
| `backend/src/fabric/check-cli.ts` | 真实 Fabric 写入与读取检查 |
| `backend/scripts/start-real-wsl.sh` | 同步源代码到 Linux、准备网络及首次部署、生成本地配置、启动后端 |
| `backend/scripts/seed-campus-demo.mjs`、`prepare-live-demo.mjs` | 可重建的四组展示活动，以及供现场领取、转让的 Pass it on. |
| `backend/package.json`、`package-lock.json` | Gateway/gRPC 依赖及运行命令 |

Fabric 镜像、工具二进制、第三方 `fabric-samples`、私钥和本机账本属于运行环境，按以下步骤安装或生成，不作为业务数据上传。

## 2. 本次核对的版本和配置文件

| 组件 | 实际版本或位置 |
| --- | --- |
| Linux | WSL 2 / Ubuntu-22.04 |
| Node.js | 22.19.0，`/opt/fairpass-dev/node-v22.19.0-linux-x64` |
| Docker | Ubuntu `docker.io`，29.1.3 |
| Compose | Ubuntu `docker-compose-v2`，2.40.3 |
| Fabric CLI / peer / orderer / ccenv / baseos / tools | 2.5.16 |
| TypeScript 链码运行镜像 | `hyperledger/fabric-nodeenv:2.5` |
| fabric-samples | `v2.4.0`，commit `0fe4d091d2549607af61bb7c7e1f3b5fa356dc70`，本机无源码修改 |
| 网络目录 | `/opt/fairpass-dev/fabric-samples/test-network` |
| 通道 / 链码 | `mychannel` / `fairpass`，初始 version 1.0、sequence 1 |

这里记录的是本机已验证的版本组合。

需要配置的文件如下；系统配置应合并到已有文件，保留其他设置。

| 文件 | 需要填写或调整的内容 | Git |
| --- | --- | --- |
| Windows `%UserProfile%\.wslconfig` | WSL 网络模式、代理继承和 DNS，见下方 | 不提交系统文件，本文保存示例 |
| WSL `/etc/wsl.conf` | 启用 systemd | 同上 |
| WSL `/etc/systemd/system/docker.service.d/fairpass-proxy.conf` | 仅在拉取镜像需要代理时填写本机代理端口 | 同上 |
| WSL `/opt/fairpass-dev/backend/.env` | 后端端口、数据库位置、随机认证密钥、Fabric 连接与证书路径 | 忽略；启动脚本首次自动生成 |
| 仓库 `frontend/.env.local` | API 地址、演示账号切换、完整卡片动画 | 忽略；需自行创建 |
| 仓库 `backend/.env.example`、`frontend/.env.example` | 可提交的配置模板 | 已提交 |

Windows `.wslconfig` 本机配置如下。mirrored 网络需要支持该功能的 Windows 11/WSL；其他环境参考 [Microsoft WSL 配置说明](https://learn.microsoft.com/en-us/windows/wsl/wsl-config)。

```ini
[wsl2]
networkingMode=mirrored
autoProxy=true
dnsTunneling=true
```

WSL `/etc/wsl.conf`：

```ini
[boot]
systemd=true
```

修改这两个文件后，保存其他 WSL 工作，再在 PowerShell 执行 `wsl.exe --shutdown`，重新打开 Ubuntu。该命令会停止所有 WSL 发行版，日常演示启动无需执行。

本机 Docker 使用以下代理配置。`7897` 是本机代理端口，换电脑应填写自己的端口；能直接拉取镜像时无需创建该文件。WSL 的 `autoProxy` 不代替 Docker 服务的代理配置。

```ini
[Service]
Environment=HTTP_PROXY=http://127.0.0.1:7897
Environment=HTTPS_PROXY=http://127.0.0.1:7897
Environment=NO_PROXY=localhost,127.0.0.1,peer0.org1.example.com,peer0.org2.example.com,orderer.example.com
```

首次配置 Docker 代理后，在 WSL 执行 `systemctl daemon-reload` 和 `systemctl restart docker`。这会重启 Docker 服务，应在启动演示网络前完成。

## 3. 新电脑首次安装

以下命令针对新的 x86_64 环境；本次已运行的环境不用重装。步骤依据本机版本整理，本次文档补充没有在第二台空白电脑上重新执行安装。

在管理员 PowerShell 安装 WSL（已有 Ubuntu-22.04 则跳过），按提示完成重启及首次用户设置：

```powershell
wsl.exe --install -d Ubuntu-22.04
```

完成上一节系统设置后，进入 WSL root shell：

```powershell
wsl.exe -d Ubuntu-22.04 -u root
```

以下在该 Linux shell 执行。本机使用 Ubuntu 提供的 Docker 包，包源版本可能随更新变化；通过 `docker --version` 和 `docker compose version` 核对。

```bash
apt-get update
apt-get install -y ca-certificates curl git tar xz-utils openssl jq build-essential python3 docker.io docker-compose-v2
service docker start
docker info
mkdir -p /opt/fairpass-dev
cd /opt/fairpass-dev
curl -fL --retry 3 -o node.tar.xz https://nodejs.org/dist/v22.19.0/node-v22.19.0-linux-x64.tar.xz
tar -xf node.tar.xz
export PATH=/opt/fairpass-dev/node-v22.19.0-linux-x64/bin:$PATH
node --version
git clone --branch v2.4.0 --depth 1 https://github.com/hyperledger/fabric-samples.git
git -C fabric-samples rev-parse HEAD
curl -fL --retry 3 -o fabric.tar.gz https://github.com/hyperledger/fabric/releases/download/v2.5.16/hyperledger-fabric-linux-amd64-2.5.16.tar.gz
tar -xzf fabric.tar.gz -C fabric-samples
fabric-samples/bin/peer version
```

安装网络及链码运行镜像。Fabric 官方安装入口见 [Install Fabric and Fabric Samples](https://hyperledger-fabric.readthedocs.io/en/release-2.5/install.html)；本项目固定工具和镜像版本以复现上述组合。每条命令成功后再继续，镜像下载失败应检查代理或官方镜像仓库。

```bash
for component in peer orderer ccenv baseos tools; do
  docker pull "hyperledger/fabric-${component}:2.5.16" || break
  docker tag "hyperledger/fabric-${component}:2.5.16" "hyperledger/fabric-${component}:latest" || break
done
docker pull hyperledger/fabric-nodeenv:2.5
docker images
```

测试网络默认通过 cryptogen 生成证书，本启动流程不使用 Fabric CA。Windows 前端另需安装 Node.js 22，并在 `frontend/` 执行 `npm ci`。不要在 Windows 和 Linux 之间共用 `node_modules`。

## 4. 日常启动与配置值

在仓库根目录的 PowerShell 启动后端。下面是当前机器的仓库路径，换电脑只需替换 `/mnt/c/Users/32349/fairpass`；仓库不必另外复制进虚拟机。

```powershell
wsl.exe -d Ubuntu-22.04 -u root -- service docker start
wsl.exe -d Ubuntu-22.04 -u root -- bash /mnt/c/Users/32349/fairpass/backend/scripts/start-real-wsl.sh
```

该脚本要求第 3 节工具已安装。它从 Windows 仓库同步后端源码及脚本到 `/opt/fairpass-dev/backend`，首次部署链码、初始化账号、安装依赖并启动服务。已有 `.env`、数据库、账本会保留；它不会自动覆盖已有 `.env`，修改配置后需重启后端。脚本也不负责升级已部署链码。

自动生成的后端 `.env` 使用以下值：

| 配置项 | 本机值或生成方式 |
| --- | --- |
| `PORT` | `3000` |
| `CORS_ORIGIN` | `http://127.0.0.1:5173,http://localhost:5173` |
| `SQLITE_PATH` | `./data/fairpass.sqlite`，相对于 WSL 后端运行目录 |
| `DEMO_TOKEN_SECRET` | 首次启动随机生成，至少 32 字符，不写入文档或提交 |
| `DEMO_TOKEN_TTL_SECONDS` | `86400` |
| `FABRIC_GATEWAY_MODE` | `real` |
| `FABRIC_CHANNEL_NAME` / `FABRIC_CHAINCODE_NAME` | `mychannel` / `fairpass` |
| `FABRIC_MSP_ID` | `Org1MSP` |
| `FABRIC_PEER_ENDPOINT` | `localhost:7051` |
| `FABRIC_PEER_HOST_ALIAS` | `peer0.org1.example.com` |
| `FABRIC_TLS_CERT_PATH` | `$TN/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt` |
| `FABRIC_CLIENT_CERT_PATH` | `$TN/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/signcerts/` 中实际证书的绝对路径 |
| `FABRIC_CLIENT_KEY_PATH` | 同一用户 `msp/keystore/` 中实际私钥的绝对路径 |

表中 `$TN` 指 `/opt/fairpass-dev/fabric-samples/test-network`；启动脚本写入完整绝对路径，手工配置时也要展开，不要把 `$TN` 字面量写入 `.env`。私钥文件名由网络生成，不能从其他机器直接照抄。

本启动方式读的是 **WSL 运行目录的 `.env`**，修改 Windows 仓库的 `backend/.env` 不会影响这个服务。若手动在 Windows 启动后端，才会读取 Windows 后端目录的配置。

创建 Windows 仓库中的 `frontend/.env.local`：

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1
VITE_TICKET_MOTION=full
```

另开 PowerShell，在 `frontend/` 执行 `npm run dev`，打开 `http://127.0.0.1:5173/`。三个角色通过真实账号登录，其中alex、jamie可相互转让。`full` 为本次演示显式启用完整卡片动画，正常部署可设为 `system`。修改前端环境文件后重启 Vite。

## 5. 演示数据、检查与保存边界

后端保持运行，另开 WSL shell：

```bash
export PATH=/opt/fairpass-dev/node-v22.19.0-linux-x64/bin:$PATH
cd /opt/fairpass-dev/backend
npm run demo:campus
npm run demo:prepare
```

第一个命令准备四组活动及alex持有的展示门票，约等 90 秒；第二个准备 Pass it on. 的已中签、未领取状态，约等 30 秒。两者都通过真实 API 写入 SQLite 和 Fabric。现场流程为：alex领取 → 翻面转让给jamie → 切换jamie查看门票和链上历史。转让立即完成。此活动约 30 天后开始，用于领取与转让；现在直接核销会因尚未进入开场前30分钟窗口而被拒绝。

需要新的未领取演示票时运行 `npm run demo:prepare -- --new`，保留旧记录。重复运行通常复用已有活动；不要删除运行清单来模拟重置。

运行清单按脚本所在目录保存：从 Windows 仓库运行时位于仓库 `.local/`，从 WSL 运行副本执行时位于 `/opt/fairpass-dev/.local/`。同一环境应固定使用一处运行脚本，否则两套清单可能创建重复活动。

真实链路检查：

```bash
npm run fabric:check
```

`fabric:check`用于检查Fabric读写连接。完整演示按 [项目说明](../README.md) 和 [录制指南](VIDEO_RECORDING_CHECKLIST.md) 完成。

Git 保存代码、图片、配置模板和演示准备逻辑；不保存 `.env`、私钥、SQLite、Docker 账本卷、`.local/` 清单或现场领取后的状态。停止后端用 Ctrl+C。暂停网络按 [后端说明](../backend/README.md#本机-wsl-联调) 使用 Compose `stop`；保留数据时不要执行 `network.sh down`。链码升级参见 [区块链说明](../blockchain/README.md#2-启动部署停止)。

## 时间异常：未来截止被判定为已过期

若Windows任务栏时间早于所填截止时间，后端仍返回“报名截止时间必须晚于当前时间”，先核对宿主机和WSL时间。2026-10-20本机曾相差约5分半：Windows时间服务显示未同步、来源为Local CMOS Clock，而WSL使用ntp.ubuntu.com。手动修改WSL时间会被网络校时覆盖，不能作为稳定修复。

只读检查（PowerShell）：

```powershell
[DateTimeOffset]::UtcNow.ToString('o')
wsl.exe -d Ubuntu-22.04 -u root -- date -u '+%Y-%m-%dT%H:%M:%SZ'
w32tm.exe /query /status
wsl.exe -d Ubuntu-22.04 -u root -- timedatectl timesync-status
```

发现Windows未同步时，优先在Windows设置“时间和语言 → 日期和时间”中启用自动设置时间并立即同步；也可在管理员终端执行 `w32tm.exe /resync /rediscover`。普通权限可能被Windows拒绝。不要关闭WSL网络校时，也不放宽后台业务时间约束。

同步后重新比对两个时钟，并按校准后的当前时间填写新的报名截止、开始和结束时间。校准后应复查两边时间一致。时钟校准不会更改已有活动设定时间，也不会重置已经领取或核销的票。

## 本机链码升级：提前验票

2026-10-20将验票开放时间从活动开始改为开场前30分钟。升级通过 `blockchain/scripts/upgrade-local-wsl.sh` 查询当前sequence后递增版本并执行官方deployCC，不重建网络或删除账本。本机已部署版本 `1.0.2`、sequence `2`，Org1与Org2均已批准。部署后使用 `peer lifecycle chaincode querycommitted`核对新版本，后端亦需用启动脚本重新同步更新。旧活动自动采用新规则，既有票权与核销状态保留。
