#!/usr/bin/env bash
username="torrserver" # system user to add || root
dirInstall="/opt/torrserver" # installation path for torrserver
serviceName="torrserver" # service name: systemctl status torrserver.service
lang="en"
scriptname=$(basename "$(test -L "$0" && readlink "$0" || echo "$0")")

#################################
#       F U N C T I O N S       #
#################################

function isRoot() {
  if [ $EUID -ne 0 ]; then
    return 1
  fi
}

function addUser() {
  if isRoot; then
    [[ $username == "root" ]] && return 0
    egrep "^$username" /etc/passwd >/dev/null
    if [ $? -eq 0 ]; then
      echo " - $username user exists!"
      return 0
    else
      useradd --home-dir "$dirInstall" --create-home --shell /bin/false -c "TorrServer" "$username"
      [ $? -eq 0 ] && {
        chmod 755 "$dirInstall"
        echo " - User $username has been added to system!"
      } || {
        echo " - Failed to add $username user!"
      }
    fi
  fi
}

function delUser() {
  if isRoot; then
    [[ $username == "root" ]] && return 0
    egrep "^$username" /etc/passwd >/dev/null
    if [ $? -eq 0 ]; then
      userdel --remove "$username" 2>/dev/null # --force 
      [ $? -eq 0 ] && {
        echo " - User $username has been removed from system!"
      } || {
        echo " - Failed to remove $username user!"
      }
    else
      echo " - $username - no such user!"
      return 1
    fi
  fi
}

function checkRunning() {
  runningPid=$(ps -ax|grep -i torrserver|grep -v grep|grep -v "$scriptname"|awk '{print $1}')
  echo $runningPid
}

function getLang() {
  lang=$(locale | grep LANG | cut -d= -f2 | tr -d '"' | cut -d_ -f1)
  [[ $lang != "ru" ]] && lang="en"
}

function getIP() {
  [ -z "`which dig`" ] && serverIP=$(host myip.opendns.com resolver1.opendns.com | tail -n1 | cut -d' ' -f4-) || serverIP=$(dig +short myip.opendns.com @resolver1.opendns.com)
}

function uninstall() {
  checkArch
  checkInstalled
  echo ""
  echo " TorrServer install dir - ${dirInstall}"
  echo ""
  echo " This action will delete TorrServer including all its torrents, settings, and files on path above!"
  echo ""
  read -p ' Are you sure you want to delete TorrServer? (Yes/No) ' answer_del </dev/tty
  if [ "$answer_del" != "${answer_del#[Yy]}" ]; then
    cleanup
    cleanAll
    echo " - TorrServer uninstalled!"
    echo ""
  else
    echo ""
  fi
}

function cleanup() {
  systemctl stop $serviceName 2>/dev/null
  systemctl disable $serviceName 2>/dev/null
  rm -rf /usr/local/lib/systemd/system/$serviceName.service $dirInstall 2>/dev/null
  delUser
}

function cleanAll() { # guess other installs
  systemctl stop torr torrserver 2>/dev/null
  systemctl disable torr torrserver 2>/dev/null
  rm -rf /home/torrserver 2>/dev/null
  rm -rf /usr/local/torr 2>/dev/null
  rm -rf /opt/torr{,*} 2>/dev/null
  rm -f /{,etc,usr/local/lib}/systemd/system/tor{,r,rserver}.service 2>/dev/null
}

function helpUsage() {
  [[ $lang == "en" ]] && echo -e "$scriptname
  -i | --install | install - install latest release version
  -u | --update  | update  - install latest update (if any)
  -c | --check   | check   - check update (show only version info)
  -d | --down    | down    - version downgrade, need version number as argument
  -r | --remove  | remove  - uninstall TorrServer
  -h | --help    | help    - this help screen
"
}

function checkOS() {
  if [[ -e /etc/debian_version ]]; then
    OS="debian"
    PKGS='curl iputils-ping dnsutils'
    source /etc/os-release
    if [[ $ID == "debian" || $ID == "raspbian" ]]; then
      if [[ $VERSION_ID -lt 6 ]]; then
        echo "Your Debian version is not supported."
        echo ""
        echo "The script only supports Debian >=6"
        echo ""
        exit 1
      fi
    elif [[ $ID == "ubuntu" ]]; then
      OS="ubuntu"
      MAJOR_UBUNTU_VERSION=$(echo "$VERSION_ID" | cut -d '.' -f1)
      if [[ $MAJOR_UBUNTU_VERSION -lt 10 ]]; then
        echo "Your Ubuntu version is not supported."
        echo ""
        echo "The script only supports Ubuntu >=10"
        echo ""
        exit 1
      fi
    fi
    if ! dpkg -s $PKGS >/dev/null 2>&1; then
      [[ $lang == "en" ]] && echo "Installing missing packages…" || echo "Installing missing packages…"
      sleep 1
      apt -y install $PKGS
    fi
  elif [[ -e /etc/system-release ]]; then
    source /etc/os-release
    if [[ $ID == "fedora" || $ID_LIKE == "fedora" ]]; then
      OS="fedora"
      [ -z "$(rpm -qa curl)" ] && yum -y install curl
      [ -z "$(rpm -qa iputils)" ] && yum -y install iputils
    fi
    if [[ $ID == "centos" || $ID == "rocky" || $ID == "redhat" ]]; then
      OS="centos"
      if [[ ! $VERSION_ID =~ (6|7|8) ]]; then
        echo "Your CentOS/RockyLinux/RedHat version is not supported."
        echo ""
        echo "The script only supports CentOS/RockyLinux/RedHat versions 6, 7, and 8."
        echo ""
        exit 1
      fi
      [ -z "$(rpm -qa curl)" ] && yum -y install curl
      [ -z "$(rpm -qa iputils)" ] && yum -y install iputils
    fi
    if [[ $ID == "ol" ]]; then
      OS="oracle"
      if [[ ! $VERSION_ID =~ (6|7|8) ]]; then
        echo "Your Oracle Linux version is not supported."
        echo ""
        echo "The script only supports Oracle Linux versions 6, 7, and 8."
        exit 1
      fi
      [ -z "$(rpm -qa curl)" ] && yum -y install curl
      [ -z "$(rpm -qa iputils)" ] && yum -y install iputils
    fi
    if [[ $ID == "amzn" ]]; then
      OS="amzn"
      if [[ $VERSION_ID != "2" ]]; then
        echo "Your Amazon Linux version is not supported."
        echo ""
        echo "The script only supports Amazon Linux 2."
        echo ""
        exit 1
      fi
      [ -z "$(rpm -qa curl)" ] && yum -y install curl
      [ -z "$(rpm -qa iputils)" ] && yum -y install iputils
    fi
  elif [[ -e /etc/arch-release ]]; then
    OS=arch
    [ -z $(pacman -Qqe curl 2>/dev/null) ] &&  pacman -Sy --noconfirm curl
    [ -z $(pacman -Qqe iputils 2>/dev/null) ] &&  pacman -Sy --noconfirm iputils
  else
    echo "It seems you are running this installer on a system other than Debian, Ubuntu, Fedora, CentOS, Amazon Linux, Oracle Linux, or Arch Linux."
    exit 1
  fi
}

function checkArch() {
  case $(uname -m) in
    i386) architecture="386" ;;
    i686) architecture="386" ;;
    x86_64) architecture="amd64" ;;
    aarch64) architecture="arm64" ;;
    armv7|armv7l) architecture="arm7" ;;
    armv6|armv6l) architecture="arm5" ;;
    *) [[ $lang == "en" ]] && { echo "Unsupported Arch. Can't continue."; exit 1; } || { echo "Unsupported Arch. Can't continue."; exit 1; } ;;
  esac
}

function checkInternet() {
  [ -z "`which ping`" ] && echo "Please install iputils-ping first" && exit 1
  [[ $lang == "en" ]] && echo "Checking Internet access…" || echo "Checking Internet access…"
  if ! ping -c 2 google.com &> /dev/null; then
    [[ $lang == "en" ]] && echo "- No Internet. Check your network and DNS settings." || echo "- No Internet. Check your network and DNS settings."
    exit 1
  fi
  [[ $lang == "en" ]] && echo "- Have Internet Access" || echo "- Have Internet Access"
}

function initialCheck() {
  if ! isRoot; then
    [[ $lang == "en" ]] && echo "Script must run as root or user with sudo privileges. Example: sudo $scriptname" || echo "Script must run as root or user with sudo privileges. Example: sudo $scriptname"
    exit 1
  fi
  # [ -z "`which curl`" ] && echo "Please install curl first" && exit 1
  checkOS
  checkArch
  checkInternet
}

function getLatestRelease() {
  curl -s "https://api.github.com/repos/YouROK/TorrServer/releases" |
  grep -iE '"tag_name":|"version":' |
  sed -E 's/.*"([^"]+)".*/\1/' |
  head -1
}

function installTorrServer() {
  [[ $lang == "en" ]] && echo "Installing and configuring TorrServer…" || echo "Installing and configuring TorrServer…"
  if checkInstalled; then
    if ! checkInstalledVersion; then
      [[ $lang == "en" ]] && read -p 'Want to update TorrServer? (Yes/No) ' answer_up </dev/tty || read -p 'Want to update TorrServer? (Yes/No) ' answer_up </dev/tty
      if [ "$answer_up" != "${answer_up#[Yy]}" ]; then
        UpdateVersion
      fi
    fi
  fi
  binName="TorrServer-linux-${architecture}"
  [[ ! -d "$dirInstall" ]] && mkdir -p ${dirInstall}
  [[ ! -d "/usr/local/lib/systemd/system" ]] && mkdir -p "/usr/local/lib/systemd/system"
  urlBin="https://github.com/YouROK/TorrServer/releases/download/$(getLatestRelease)/${binName}"
  if [[ ! -f "$dirInstall/$binName" ]] | [[ ! -x "$dirInstall/$binName" ]] || [[ $(stat -c%s "$dirInstall/$binName" 2>/dev/null) -eq 0 ]]; then
    curl -L --progress-bar -# -o "$dirInstall/$binName" "$urlBin"
    chmod +x "$dirInstall/$binName"
  fi
  cat << EOF > $dirInstall/$serviceName.service
    [Unit]
    Description = TorrServer - stream torrent to http
    Wants = network-online.target
    After = network.target

    [Service]
    User = $username
    Group = $username
    Type = simple
    NonBlocking = true
    EnvironmentFile = $dirInstall/$serviceName.config
    ExecStart = ${dirInstall}/${binName} \$DAEMON_OPTIONS
    ExecReload = /bin/kill -HUP \${MAINPID}
    ExecStop = /bin/kill -INT \${MAINPID}
    TimeoutSec = 30
    #WorkingDirectory = ${dirInstall}
    Restart = on-failure
    RestartSec = 5s
    #LimitNOFILE = 4096

    [Install]
    WantedBy = multi-user.target
EOF
  servicePort="8090"
  isAuth=1
  isRdb=0
  if [ $isAuth -eq 1 ]; then
    [[ ! -f "$dirInstall/accs.db" ]] && {
	  echo "Currently, it is required for you to devise the credentials that will be utilized for authorization purposes."
      read -p 'Login: ' answer_user </dev/tty
      isAuthUser=$answer_user
      read -p 'Password: ' answer_pass </dev/tty
      isAuthPass=$answer_pass
      echo "Store $isAuthUser:$isAuthPass to ${dirInstall}/accs.db"
      echo -e "{\n  \"$isAuthUser\": \"$isAuthPass\"\n}" > $dirInstall/accs.db
    } || {
      auth=$(cat "$dirInstall/accs.db"|head -2|tail -1|tr -d '[:space:]'|tr -d '"')
      echo "Use existing auth from ${dirInstall}/accs.db for authorization - $auth"
    }
    cat << EOF > $dirInstall/$serviceName.config
    DAEMON_OPTIONS="--port $servicePort --path $dirInstall --httpauth"
EOF
  else
    cat << EOF > $dirInstall/$serviceName.config
    DAEMON_OPTIONS="--port $servicePort --path $dirInstall"
EOF
  fi
  if [ $isRdb -eq 1 ]; then
    echo "Set database to read-only mode…"
    echo "To change remove --rdb option from $dirInstall/$serviceName.config"
    echo "or rerun install script without parameters"
    sed -i 's|DAEMON_OPTIONS="--port|DAEMON_OPTIONS="--rdb --port|' $dirInstall/$serviceName.config
  fi
  [ -z $isLog ] && {
    sed -i "s|--path|--logpath $dirInstall/$serviceName.log --path|" "$dirInstall/$serviceName.config"
    echo "TorrServer log stored at $dirInstall/$serviceName.log"
  }

  ln -sf $dirInstall/$serviceName.service /usr/local/lib/systemd/system/
  sed -i 's/^[ \t]*//' $dirInstall/$serviceName.service
  sed -i 's/^[ \t]*//' $dirInstall/$serviceName.config

  echo "Starting TorrServer…"
  systemctl daemon-reload 2>/dev/null
  systemctl enable $serviceName.service 2>/dev/null # enable --now
  systemctl restart $serviceName.service 2>/dev/null
  getIP
  echo ""
  echo "TorrServer $(getLatestRelease) installed to ${dirInstall}"
  echo ""
  echo "You can now open your browser at http://${serverIP}:${servicePort} to access TorrServer web GUI."
  echo ""
  if [[ $isAuth -eq 1 && $isAuthUser > 0 ]]; then
    echo "Use user \"$isAuthUser\" with password \"$isAuthPass\" for authentication"
  echo ""
  fi
}

function checkInstalled() {
  if ! addUser; then
    username="root"
  fi
  binName="TorrServer-linux-${architecture}"
  if [[ -f "$dirInstall/$binName" ]] || [[ $(stat -c%s "$dirInstall/$binName" 2>/dev/null) -ne 0 ]]; then
    echo " - TorrServer found in $dirInstall"
  else
    echo " - TorrServer not found. It's not installed or have zero size."
    return 1
  fi
}

function checkInstalledVersion() {
  binName="TorrServer-linux-${architecture}"
  if [[ -z "$(getLatestRelease)" ]]; then
    echo " - No update. Can be server issue."
    exit 1
  fi
  if [[ "$(getLatestRelease)" == "$($dirInstall/$binName --version 2>/dev/null | awk '{print $2}')" ]]; then
    echo " - You have latest TorrServer $(getLatestRelease)"
  else
    echo " - TorrServer update found!"
    echo "   installed: \"$($dirInstall/$binName --version 2>/dev/null | awk '{print $2}')\""
    echo "   available: \"$(getLatestRelease)\""
    return 1
  fi
}

function UpdateVersion() {
  systemctl stop $serviceName.service
  binName="TorrServer-linux-${architecture}"
  urlBin="https://github.com/YouROK/TorrServer/releases/download/$(getLatestRelease)/${binName}"
  curl -L --progress-bar -# -o "$dirInstall/$binName" "$urlBin"
  chmod +x "$dirInstall/$binName"
  systemctl start $serviceName.service
}

function DowngradeVersion() {
  systemctl stop $serviceName.service
  binName="TorrServer-linux-${architecture}"
  urlBin="https://github.com/YouROK/TorrServer/releases/download/MatriX.$downgradeRelease/${binName}"
  curl -L --progress-bar -# -o "$dirInstall/$binName" "$urlBin"
  chmod +x "$dirInstall/$binName"
  systemctl start $serviceName.service
}
#####################################
#     E N D   F U N C T I O N S     #
#####################################
getLang
case $1 in
  -i|--install|install)
    initialCheck
    if ! checkInstalled; then
      servicePort="8090"
      isAuth=0
      isRdb=0
      isLog=0
      installTorrServer
    else
      systemctl stop $serviceName.service
      systemctl start $serviceName.service
    fi
    exit
    ;;
  -u|--update|update)
    initialCheck
    if checkInstalled; then
      if ! checkInstalledVersion; then
        UpdateVersion
      fi
    fi
    exit
    ;;
  -c|--check|check)
    initialCheck
    if checkInstalled; then
      checkInstalledVersion
    fi
    exit
    ;;
  -d|--down|down)
    initialCheck
    downgradeRelease="$2"
    [ -z "$downgradeRelease" ] &&
      echo "You did not specify a version number" &&
      echo "Type $scriptname -d|-down|down <version>, for example, $scriptname -d 101" &&
      exit 1
    if checkInstalled; then
      DowngradeVersion
    fi
    exit
    ;;
  -r|--remove|remove)
    uninstall
    exit
    ;;
  -h|--help|help)
    helpUsage
    exit
    ;;
  *)
    echo ""
    echo "============================================================="
    echo " Welcome to the TorrServer Installer by SpaceCore "
    echo "============================================================="
    echo ""
	echo "### Original Version: https://github.com/YouROK/TorrServer"
	echo ""
    echo "Enter $scriptname -h or --help or help for all available commands"
    ;;
esac

while true; do
  initialCheck
  installTorrServer
  break
done

echo "Have Fun!"
echo ""
sleep 3