# 코인차트 앱 — Play Store 등록 가이드

PWA를 TWA(Trusted Web Activity)로 감싸 Play Store에 올리는 절차.
코드 수정 없이 지금 이 폴더 그대로 사용.

## 0. 사전 준비

| 항목 | 내용 |
|---|---|
| Google Play 개발자 계정 | https://play.google.com/console — 1회 $25 |
| GitHub Pages 배포 | 이 폴더를 공개 저장소에 push (아래 1단계) |
| Google OAuth 클라이언트 ID | 로그인 활성화용 (선택, 아래 4단계) |

## 1. GitHub Pages 배포

```bash
# 예: coinchart-app 저장소 새로 만들었다고 가정
cd coinchart-app
git init
git add .
git commit -m "feat: 코인차트 모바일 앱 v1"
git remote add origin https://github.com/cassmania/coinchart-app.git
git push -u origin main
```

GitHub 저장소 → Settings → Pages → Branch `main` / root 선택.
배포 주소: `https://cassmania.github.io/coinchart/app/`

## 2. 경로 A — PWABuilder (권장, 제일 쉬움)

1. https://www.pwabuilder.com 접속
2. 배포 주소 입력 → Start
3. "Package for Stores" → Android 선택
4. `twa-manifest.json` 값 참고해 Package ID 등 입력
   - Package ID: `io.github.cassmania.coinchart`
5. `.aab` 파일 + `assetlinks.json` 다운로드
6. `assetlinks.json`을 저장소의 `.well-known/assetlinks.json` 경로에 push
   (이거 없으면 앱 상단에 브라우저 주소창 뜸)
7. Play Console → 앱 만들기 → `.aab` 업로드 → 심사 제출

## 3. 경로 B — Bubblewrap CLI (로컬 빌드)

JDK 17 + Android SDK 필요. Node 설치되어 있으면:

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://cassmania.github.io/coinchart/app/manifest.json
# 이 폴더의 twa-manifest.json 값으로 응답하면 됨
bubblewrap build
# 결과: app-release-signed.apk + app-release-bundle.aab
```

서명키(`android.keystore`)는 생성 시 백업 필수 — 분실하면 업데이트 불가.

## 4. Google 로그인 활성화 (선택)

1. https://console.cloud.google.com → 프로젝트 생성
2. API 및 서비스 → OAuth 동의 화면 구성 (외부, 앱 이름/이메일만 필수)
3. 사용자 인증 정보 → OAuth 클라이언트 ID → 웹 애플리케이션
   - 승인된 자바스크립트 원본: `https://cassmania.github.io`
4. 발급된 ID를 `app.js` 맨 위 `GOOGLE_CLIENT_ID`에 붙여넣기

미설정 시 게스트 모드로 전체 기능 동작.

## 5. 심사 통과 체크리스트

- [ ] `.well-known/assetlinks.json` 배포 확인 (주소창 사라짐)
- [ ] 개인정보처리방침 URL (Play Console 필수) — GitHub Pages에 정적 페이지 하나 추가
- [ ] 스크린샷 2장 이상 (폰 세로), 512px 아이콘, 1024x500 피처 그래픽
- [ ] 금융 앱 아님 명시: "정보 제공용, 투자 조언 아님" 문구를 스토어 설명에 포함
      (암호화폐 관련 앱은 심사에서 이 부분 봄)
- [ ] 콘텐츠 등급 설문 작성

## 파일 안내

- `twa-manifest.json` — Bubblewrap/PWABuilder 설정값 (packageId, 색상, 시작 URL)
- `manifest.json` — PWA 매니페스트 (앱 이름, 아이콘, standalone 모드)
- `sw.js` — 오프라인 셸 캐시 (Play Store TWA 요건인 서비스워커 충족)
