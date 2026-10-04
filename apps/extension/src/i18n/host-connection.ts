/** Native Host setup and connection status in each supported interface language. */
export const hostConnectionCopy = {
  en: {
    windowsRequirements:
      "Windows requires Windows PowerShell 5.1 and .NET Framework to create the Native Host launcher during installation. Run Node.js commands in PowerShell or Command Prompt; administrator rights are not required.",
    linuxRequirements:
      "Linux folder selection requires zenity or kdialog. Host installation and AI generation do not require these tools.",
    uninstall: "Uninstall Host",
    uninstallSteps:
      "Wait for tasks to finish and close the browser. Run this in the project or extracted Host folder.",
    uninstallEffects:
      "Local features require reinstalling the Host. Lessons and sign-ins are kept.",
    uninstallUnavailable:
      "AI generation, local lesson access and backups in this browser require reinstalling the Host afterward.",
    uninstallBrowser: "Browser to unregister",
    commandLocation: "Run command from",
    packageFolder: "Extracted Host ZIP folder",
    projectFolder: "Project root",
    uninstallPackageSteps:
      "Requires Node.js 22+ and a Host ZIP containing scripts/uninstall-host.mjs. If you deleted the extracted folder or have an older package, download the updated Host ZIP and run this command from its extracted folder.",
    uninstallSourceSteps:
      "Run this command from the updated project root (Node.js 22+ and pnpm required). No extension ID is needed.",
    copyUninstallCommand: "Copy uninstall command",

    title: "Local connection service",
    name: "Native Host",
    help: "The local service embeds Pi SDK and connects to your selected AI provider. No CLI installation is required.",
    connected: "Connected",
    disconnected: "Not connected",
    checking: "Checking connection…",
    version: "Host version",
    updateNeeded: "Host update required",
    unsupportedMode:
      "This Host does not support the current AI service. Install the matching Host, then reload the extension.",
    protocolMismatch:
      "Host and extension are incompatible. Reinstall the matching Host, then reload the extension.",
    mismatch:
      "Host and extension versions differ. Reinstall the matching Host, then reload the extension.",
    chooseOS: "Operating system",
    chooseBrowser: "Browser",
    install: "Install the local service",
    steps:
      "Download the Host ZIP matching this extension version and your operating system, extract it, then run this command from its folder (Node.js 22+ required):",
    releases: "Open Host downloads",
    copyID: "Copy extension ID",
    copyCommand: "Copy install command",
    copied: "Copied.",
    check: "Check connection",
    checkSucceeded: "Check complete. Host is connected.",
    lastChecked: "Last checked",
    manual:
      "Confirm the selected browser. Chrome, Edge and Chromium each require their own Host registration.",
    error: "Could not copy. Select and copy the command manually.",
    connectionFailed:
      "Unable to connect to the Host. Install it for this extension ID and browser, then reload the extension and check again.",
    installMethod: "Installation method",
    packageInstall: "Download a Host package",
    sourceInstall: "Update from the project",
    sourceSteps:
      "From the project root, rebuild and install the Host with these commands (Node.js 22+ and pnpm required):",
    afterInstall:
      "After installing, reload the extension on your browser’s extensions page, then check the connection again.",
  },
  "zh-TW": {
    windowsRequirements:
      "Windows 安裝時需要 Windows PowerShell 5.1 與 .NET Framework 建立 Host launcher。Node.js 指令可在 PowerShell 或命令提示字元執行，不需系統管理員權限。",
    linuxRequirements:
      "Linux 的圖形化資料夾選擇需要 zenity 或 kdialog；安裝 Host 與 AI 生成不需要這兩項工具。",
    uninstall: "解除安裝 Host",
    uninstallSteps: "等任務完成並關閉瀏覽器，再於專案或 Host 解壓縮資料夾執行。",
    uninstallEffects: "解除安裝後，本機功能需重新安裝 Host 才能使用；教材與登入資料保留。",
    uninstallUnavailable:
      "解除安裝後，該瀏覽器的 AI 生成、本機教材存取與備份功能，需要重新安裝 Host 才能使用。",
    uninstallBrowser: "要解除安裝的瀏覽器",
    commandLocation: "指令執行位置",
    packageFolder: "Host ZIP 解壓縮資料夾",
    projectFolder: "專案根目錄",
    uninstallPackageSteps:
      "需要 Node.js 22+，以及包含 scripts/uninstall-host.mjs 的 Host ZIP。若已刪除解壓縮資料夾或使用舊套件，請下載新版 Host ZIP，解壓縮後在該資料夾執行以下指令。",
    uninstallSourceSteps:
      "在更新後的專案根目錄執行以下指令（需要 Node.js 22+ 與 pnpm），不需擴充功能 ID。",
    copyUninstallCommand: "複製解除安裝指令",

    title: "本機連接服務",
    name: "Native Host",
    help: "本機服務內建 Pi SDK，負責連接所選 AI 服務，不需另外安裝 CLI。",
    connected: "已連線",
    disconnected: "尚未連線",
    checking: "正在檢查連線…",
    version: "Host 版本",
    updateNeeded: "Host 需要更新",
    unsupportedMode: "此 Host 不支援目前的 AI 服務，請安裝相符的 Host，再重新載入擴充功能。",
    protocolMismatch: "Host 與擴充功能不相容，請重新安裝相符的 Host，再重新載入擴充功能。",
    mismatch: "Host 與擴充功能版本不同，請重新安裝相符的 Host，再重新載入擴充功能。",
    chooseOS: "作業系統",
    chooseBrowser: "瀏覽器",
    install: "安裝本機連接服務",
    steps:
      "下載與此擴充功能版本及作業系統相符的 Host ZIP，解壓縮後，在該資料夾執行以下指令（需要 Node.js 22+）：",
    releases: "開啟 Host 下載頁",
    copyID: "複製擴充功能 ID",
    copyCommand: "複製安裝指令",
    copied: "已複製。",
    check: "檢查連線",
    checkSucceeded: "檢查完成，Host 已連線。",
    lastChecked: "上次檢查",
    manual: "請確認所選瀏覽器。Chrome、Edge 與 Chromium 需要分別註冊 Host。",
    error: "無法複製，請手動選取指令。",
    connectionFailed:
      "無法連接 Host。請使用目前的擴充功能 ID，為所選瀏覽器安裝 Host，再重新載入擴充功能並檢查連線。",
    installMethod: "安裝方式",
    packageInstall: "下載 Host 套件",
    sourceInstall: "從專案更新",
    sourceSteps: "在專案根目錄執行以下指令，重新建置並安裝 Host（需要 Node.js 22+ 與 pnpm）：",
    afterInstall: "安裝完成後，到瀏覽器的擴充功能頁重新載入此擴充功能，再檢查連線。",
  },
  "zh-CN": {
    windowsRequirements:
      "Windows 安装时需要 Windows PowerShell 5.1 与 .NET Framework 创建 Host launcher。Node.js 命令可在 PowerShell 或命令提示符执行，无需管理员权限。",
    linuxRequirements:
      "Linux 的图形化文件夹选择需要 zenity 或 kdialog；安装 Host 与 AI 生成不需要这两项工具。",
    uninstall: "卸载 Host",
    uninstallSteps: "等待任务完成并关闭浏览器，再在项目或 Host 解压文件夹执行。",
    uninstallEffects: "卸载后，本地功能需重新安装 Host 才能使用；教材与登录数据保留。",
    uninstallUnavailable:
      "卸载后，该浏览器的 AI 生成、本地教材访问与备份功能，需要重新安装 Host 才能使用。",
    uninstallBrowser: "要卸载的浏览器",
    commandLocation: "命令执行位置",
    packageFolder: "Host ZIP 解压文件夹",
    projectFolder: "项目根目录",
    uninstallPackageSteps:
      "需要 Node.js 22+，以及包含 scripts/uninstall-host.mjs 的 Host ZIP。若已删除解压文件夹或使用旧包，请下载新版 Host ZIP，解压后在该文件夹执行以下命令。",
    uninstallSourceSteps:
      "在更新后的项目根目录执行以下命令（需要 Node.js 22+ 与 pnpm），无需扩展 ID。",
    copyUninstallCommand: "复制卸载命令",

    title: "本地连接服务",
    name: "Native Host",
    help: "本地服务内置 Pi SDK，负责连接所选 AI 服务，无需另外安装 CLI。",
    connected: "已连接",
    disconnected: "尚未连接",
    checking: "正在检查连接…",
    version: "Host 版本",
    updateNeeded: "Host 需要更新",
    unsupportedMode: "此 Host 不支持当前的 AI 服务，请安装匹配的 Host，再重新加载扩展。",
    protocolMismatch: "Host 与扩展不兼容，请重新安装匹配的 Host，再重新加载扩展。",
    mismatch: "Host 与扩展版本不同，请重新安装匹配的 Host，再重新加载扩展。",
    chooseOS: "操作系统",
    chooseBrowser: "浏览器",
    install: "安装本地连接服务",
    steps:
      "下载与此扩展版本及操作系统匹配的 Host ZIP，解压后从该文件夹运行以下命令（需要 Node.js 22+）：",
    releases: "打开 Host 下载页面",
    copyID: "复制扩展 ID",
    copyCommand: "复制安装命令",
    copied: "已复制。",
    check: "检查连接",
    checkSucceeded: "检查完成，Host 已连接。",
    lastChecked: "上次检查",
    manual: "请确认所选浏览器。Chrome、Edge 和 Chromium 需要分别注册 Host。",
    error: "无法复制，请手动选择命令。",
    connectionFailed:
      "无法连接 Host。请使用当前扩展 ID，为所选浏览器安装 Host，再重新加载扩展并检查连接。",
    installMethod: "安装方式",
    packageInstall: "下载 Host 包",
    sourceInstall: "从项目更新",
    sourceSteps: "在项目根目录运行以下命令，重新构建并安装 Host（需要 Node.js 22+ 和 pnpm）：",
    afterInstall: "安装完成后，到浏览器扩展页面重新加载此扩展，再检查连接。",
  },
  ja: {
    windowsRequirements:
      "Windows のインストールでは Host launcher の作成に Windows PowerShell 5.1 と .NET Framework が必要です。Node.js コマンドは PowerShell またはコマンドプロンプトで実行できます。管理者権限は不要です。",
    linuxRequirements:
      "Linux のグラフィカルなフォルダー選択には zenity または kdialog が必要です。Host のインストールや AI 生成には不要です。",
    uninstall: "Host をアンインストール",
    uninstallSteps:
      "タスク完了後にブラウザーを閉じ、プロジェクトまたは Host の展開フォルダーで実行してください。",
    uninstallEffects:
      "ローカル機能の利用には Host の再インストールが必要です。教材とログイン情報は保持されます。",
    uninstallUnavailable:
      "このブラウザーで AI 生成、ローカル教材へのアクセス、バックアップを再び利用するには、Host の再インストールが必要です。",
    uninstallBrowser: "登録を解除するブラウザー",
    commandLocation: "コマンドの実行場所",
    packageFolder: "Host ZIP の展開フォルダー",
    projectFolder: "プロジェクトのルート",
    uninstallPackageSteps:
      "Node.js 22+ と scripts/uninstall-host.mjs を含む Host ZIP が必要です。展開フォルダーを削除した場合や古いパッケージを使用している場合は、新しい Host ZIP をダウンロード・展開し、そのフォルダーで次のコマンドを実行してください。",
    uninstallSourceSteps:
      "更新したプロジェクトのルートで次のコマンドを実行してください（Node.js 22+ と pnpm が必要）。拡張機能 ID は不要です。",
    copyUninstallCommand: "アンインストールコマンドをコピー",

    title: "ローカル接続サービス",
    name: "Native Host",
    help: "ローカルサービスに Pi SDK が内蔵されています。CLI のインストールは不要です。",
    connected: "接続済み",
    disconnected: "未接続",
    checking: "接続を確認中…",
    version: "Host バージョン",
    updateNeeded: "Host の更新が必要です",
    unsupportedMode:
      "この Host は現在の AI サービスに対応していません。対応する Host をインストールし、拡張機能を再読み込みしてください。",
    protocolMismatch:
      "Host と拡張機能に互換性がありません。対応する Host を再インストールし、拡張機能を再読み込みしてください。",
    mismatch:
      "Host と拡張機能のバージョンが異なります。対応する Host を再インストールし、拡張機能を再読み込みしてください。",
    chooseOS: "OS",
    chooseBrowser: "ブラウザー",
    install: "ローカルサービスをインストール",
    steps:
      "拡張機能のバージョンと OS に対応する Host ZIP をダウンロード・解凍し、そのフォルダーで次のコマンドを実行してください（Node.js 22+ が必要）：",
    releases: "Host ダウンロードを開く",
    copyID: "拡張機能 ID をコピー",
    copyCommand: "インストールコマンドをコピー",
    copied: "コピーしました。",
    check: "接続を確認",
    checkSucceeded: "確認が完了しました。Host に接続しています。",
    lastChecked: "最終確認",
    manual:
      "選択したブラウザーを確認してください。Chrome・Edge・Chromium はそれぞれ Host の登録が必要です。",
    error: "コピーできません。手動でコマンドを選択してください。",
    connectionFailed:
      "Host に接続できません。現在の拡張機能 ID とブラウザーで Host を登録し、拡張機能を再読み込みして接続を確認してください。",
    installMethod: "インストール方法",
    packageInstall: "Host パッケージをダウンロード",
    sourceInstall: "プロジェクトから更新",
    sourceSteps:
      "プロジェクトのルートで次のコマンドを実行し、Host を再ビルドしてインストールしてください（Node.js 22+ と pnpm が必要）：",
    afterInstall:
      "インストール後、ブラウザーの拡張機能ページでこの拡張機能を再読み込みし、接続を確認してください。",
  },
  ko: {
    windowsRequirements:
      "Windows 설치 시 Host launcher를 만들려면 Windows PowerShell 5.1과 .NET Framework가 필요합니다. Node.js 명령은 PowerShell 또는 명령 프롬프트에서 실행할 수 있으며 관리자 권한은 필요하지 않습니다.",
    linuxRequirements:
      "Linux의 그래픽 폴더 선택에는 zenity 또는 kdialog가 필요합니다. Host 설치와 AI 생성에는 필요하지 않습니다.",
    uninstall: "Host 제거",
    uninstallSteps:
      "작업 완료 후 브라우저를 닫고 프로젝트 또는 Host 압축 해제 폴더에서 실행하세요.",
    uninstallEffects:
      "로컬 기능을 다시 사용하려면 Host를 재설치해야 합니다. 학습 자료와 로그인 정보는 유지됩니다.",
    uninstallUnavailable:
      "이 브라우저에서 AI 생성, 로컬 학습 자료 접근 및 백업을 다시 사용하려면 Host를 다시 설치해야 합니다.",
    uninstallBrowser: "등록을 제거할 브라우저",
    commandLocation: "명령 실행 위치",
    packageFolder: "Host ZIP 압축 해제 폴더",
    projectFolder: "프로젝트 루트",
    uninstallPackageSteps:
      "Node.js 22+ 및 scripts/uninstall-host.mjs가 포함된 Host ZIP이 필요합니다. 압축 해제 폴더를 삭제했거나 이전 패키지를 사용 중이라면 새 Host ZIP을 다운로드하여 압축을 풀고 해당 폴더에서 다음 명령을 실행하세요.",
    uninstallSourceSteps:
      "업데이트한 프로젝트 루트에서 다음 명령을 실행하세요 (Node.js 22+ 및 pnpm 필요). 확장 프로그램 ID는 필요 없습니다.",
    copyUninstallCommand: "제거 명령 복사",

    title: "로컬 연결 서비스",
    name: "Native Host",
    help: "로컬 서비스에 Pi SDK가 내장되어 있습니다. CLI 설치가 필요 없습니다.",
    connected: "연결됨",
    disconnected: "연결되지 않음",
    checking: "연결 확인 중…",
    version: "Host 버전",
    updateNeeded: "Host 업데이트 필요",
    unsupportedMode:
      "이 Host는 현재 AI 서비스를 지원하지 않습니다. 일치하는 Host를 설치한 뒤 확장 프로그램을 다시 로드하세요.",
    protocolMismatch:
      "Host와 확장 프로그램이 호환되지 않습니다. 일치하는 Host를 다시 설치한 뒤 확장 프로그램을 다시 로드하세요.",
    mismatch:
      "Host와 확장 프로그램 버전이 다릅니다. 일치하는 Host를 다시 설치한 뒤 확장 프로그램을 다시 로드하세요.",
    chooseOS: "운영 체제",
    chooseBrowser: "브라우저",
    install: "로컬 서비스 설치",
    steps:
      "확장 프로그램 버전과 운영 체제에 맞는 Host ZIP을 다운로드하여 압축을 풀고 해당 폴더에서 명령을 실행하세요 (Node.js 22+ 필요):",
    releases: "Host 다운로드 열기",
    copyID: "확장 프로그램 ID 복사",
    copyCommand: "설치 명령 복사",
    copied: "복사했습니다.",
    check: "연결 확인",
    checkSucceeded: "확인이 완료되었습니다. Host에 연결되었습니다.",
    lastChecked: "마지막 확인",
    manual: "선택한 브라우저를 확인하세요. Chrome, Edge, Chromium은 각각 Host 등록이 필요합니다.",
    error: "복사할 수 없습니다. 명령을 수동 선택하세요.",
    connectionFailed:
      "Host에 연결할 수 없습니다. 현재 확장 프로그램 ID와 선택한 브라우저로 Host를 등록한 뒤 확장 프로그램을 다시 로드하고 연결을 확인하세요.",
    installMethod: "설치 방법",
    packageInstall: "Host 패키지 다운로드",
    sourceInstall: "프로젝트에서 업데이트",
    sourceSteps:
      "프로젝트 루트에서 다음 명령으로 Host를 다시 빌드하고 설치하세요 (Node.js 22+ 및 pnpm 필요):",
    afterInstall:
      "설치 후 브라우저의 확장 프로그램 페이지에서 이 확장 프로그램을 다시 로드하고 연결을 확인하세요.",
  },
} as const;
