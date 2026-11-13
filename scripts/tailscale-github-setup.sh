#!/usr/bin/env bash
# Interactive GitHub Actions + Tailscale OAuth setup. Secrets are never stored on disk.
set -Eeuo pipefail
umask 077
REPO="tkinder221-del/codexpro"
WORKFLOW="tailscale-connect.yml"
DOCS="https://login.tailscale.com/admin/settings/oauth"
TARGET_DEFAULT="vps-1c0d8198.tail88fe4e.ts.net"
export GH_PROMPT_DISABLED=1

if [[ ${EUID} -eq 0 ]]; then
  if id ubuntu &>/dev/null && sudo -u ubuntu gh auth status &>/dev/null; then
    # /root is private; copy to an accessible temporary directory first.
    temp_dir=$(mktemp -d /tmp/codexpro-ts-setup.XXXXXXXX)
    chmod 755 "$temp_dir"
    install -m 755 "$0" "$temp_dir/setup.sh"
    trap 'rm -rf "$temp_dir"' EXIT
    sudo -u ubuntu bash "$temp_dir/setup.sh" "$@"
    exit $?
  fi
  echo 'Uruchom skrypt jako uzytkownik zalogowany w GitHub CLI (np. ubuntu).' >&2
  exit 1
fi
for tool in whiptail gh; do
  command -v "$tool" >/dev/null || { echo "Brak programu: $tool" >&2; exit 1; }
done
[[ -t 0 && -t 1 ]] || { echo 'Skrypt wymaga interaktywnego terminala SSH.' >&2; exit 1; }
if ! gh auth status >/dev/null 2>&1; then
  whiptail --title 'GitHub CLI' --msgbox 'Brak logowania do GitHub. Uruchom: gh auth login, a nastepnie ten skrypt ponownie.' 11 70
  exit 1
fi

msg() { whiptail --title 'CodexPro + Tailscale' --msgbox "$1" 17 78; }
ask() { whiptail --title 'CodexPro + Tailscale' --yesno "$1" 15 78; }
secret_input() {
  local label="$1" value
  value=$(whiptail --title 'Poufne dane OAuth' --passwordbox "$label" 13 78 3>&1 1>&2 2>&3) || return 1
  [[ -n "$value" ]] || return 1
  printf '%s' "$value"
}
set_secret() {
  local key="$1" value
  value=$(secret_input "Wklej $key z panelu Tailscale. Wartosc nie bedzie zapisana na dysku.") || return 1
  if ! printf '%s' "$value" | gh secret set "$key" -R "$REPO" >/dev/null; then
    unset value
    msg "Nie udalo sie zapisac $key. Sprawdz uprawnienia GitHub CLI."
    return 1
  fi
  unset value
  return 0
}
show_status() {
  local names
  if ! names=$(gh api "repos/$REPO/actions/secrets" --jq '.secrets[].name' 2>/dev/null); then
    msg 'Nie moge odczytac sekretow repozytorium. Sprawdz uprawnienia gh.'
    return
  fi
  local a='BRAK' b='BRAK'
  grep -Fxq 'TS_OAUTH_CLIENT_ID' <<<"$names" && a='USTAWIONY'
  grep -Fxq 'TS_OAUTH_SECRET' <<<"$names" && b='USTAWIONY'
  msg "Repozytorium: $REPO\nTS_OAUTH_CLIENT_ID: $a\nTS_OAUTH_SECRET: $b\n\nGitHub nie ujawnia wartosci zapisanych sekretow."
}
run_workflow() {
  local target
  target=$(whiptail --title 'Test Tailscale' --inputbox 'Podaj MagicDNS / IP Tailscale do testu (puste = bez ping):' 13 78 "$TARGET_DEFAULT" 3>&1 1>&2 2>&3) || return
  if [[ -n "$target" && ! "$target" =~ ^[a-zA-Z0-9.:-]+$ ]]; then
    msg 'Niepoprawny host. Dozwolone sa litery, cyfry, kropki, dwukropki i myslniki.'
    return
  fi
  if gh workflow run "$WORKFLOW" -R "$REPO" --ref main -f "target=$target"; then
    msg 'Workflow uruchomiony. Wybierz opcje Wyniki, aby sprawdzic status.'
  else
    msg 'Nie udalo sie uruchomic workflow. Sprawdz dostep i sekrety.'
  fi
}
show_runs() {
  local out
  out=$(gh run list -R "$REPO" --workflow "$WORKFLOW" --limit 5 --json status,conclusion,url --jq '.[] | "\(.status) / \(.conclusion) : \(.url)"' 2>&1) || true
  msg "Ostatnie uruchomienia:\n\n${out:-Brak uruchomien.}"
}

msg "Kreator polaczenia GitHub Actions z Tailscale.\n\n1. Utworz OAuth Client w Tailscale.\n2. Nadaj auth_keys:write i tag:ci.\n3. Wklej ID i sekret w tym kreatorze.\n4. Uruchom test.\n\nNie udostepniaj sekretu na czacie ani w logach."
while true; do
  choice=$(whiptail --title 'CodexPro | Tailscale GitHub Setup' --menu 'Wybierz krok:' 21 84 10 \
    1 'Instrukcja tworzenia klienta OAuth' \
    2 'Zapisz TS_OAUTH_CLIENT_ID do GitHub' \
    3 'Zapisz TS_OAUTH_SECRET do GitHub' \
    4 'Sprawdz zapisane sekrety' \
    5 'Uruchom test polaczenia Tailscale' \
    6 'Pokaz wyniki GitHub Actions' \
    0 'Zakoncz' 3>&1 1>&2 2>&3) || break
  case "$choice" in
    1) msg "Otworz na swoim komputerze:\n$DOCS\n\nKliknij Generate OAuth client.\nWybierz uprawnienie auth_keys:write i tag tag:ci.\nTag tag:ci musi byc dozwolony w polityce tailnet.\n\nZapisz Client ID oraz Client Secret (sekret moze byc pokazany tylko raz).\n\nWroc do menu i wybierz 2 oraz 3." ;;
    2) set_secret TS_OAUTH_CLIENT_ID && msg 'Client ID zapisany w GitHub Actions Secrets.' || msg 'Anulowano lub nie udalo sie zapisac Client ID.' ;;
    3) set_secret TS_OAUTH_SECRET && msg 'Client Secret zapisany w GitHub Actions Secrets.' || msg 'Anulowano lub nie udalo sie zapisac Client Secret.' ;;
    4) show_status ;;
    5) ask 'Czy utworzono OAuth Client, ustawiono tag:ci i zapisano oba sekrety? Uruchomic test?' && run_workflow ;;
    6) show_runs ;;
    0) break ;;
  esac
done
clear
printf 'Kreator zakonczony. Workflow: https://github.com/%s/actions/workflows/%s\n' "$REPO" "$WORKFLOW"
