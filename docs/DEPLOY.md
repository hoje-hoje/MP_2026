# 서버 실행·배포 안내

## 1. 내 컴퓨터에서 돌려 보기 (지금 바로 가능)

Node.js 18 이상이 필요하다.

```bash
cd server
npm install
npm start
```

브라우저에서 `http://localhost:8080` 을 열면 입장 화면이 나온다. 창을 두 개 열어 같은 팀 번호로 들어가면 서로 보이고 나라 채팅이 된다.
같은 와이파이의 다른 기기에서는 `http://<내 컴퓨터 IP>:8080` 으로 들어올 수 있다.

부하 테스트 (가짜 접속자 150명):

```bash
cd server
node test/bots.js 150 ws://localhost:8080/ws 30
```

2026-11-12 측정: 150명 동시 접속, 오류 0, 서버 CPU 한 코어의 약 6%, 메모리 약 80MB.
→ 가장 작은 서버로 충분하다.

## 2. 인터넷에 올리기: Render 무료 + MongoDB Atlas 무료 (0원)

무료 Render 서버는 15분 동안 아무도 없으면 잠들고, 다시 켜질 때 서버 안의 파일이 지워진다.
그래서 게임 상태(나라·영토·병력·전투 기록)는 **MongoDB Atlas 무료 DB**에 저장한다.
서버는 `MONGODB_URI` 가 있으면 자동으로 Atlas에 저장하고, 하루 한 번 백업본도 남긴다.

### ① MongoDB Atlas (5분)
1. https://www.mongodb.com/cloud/atlas/register 에서 가입 (구글 계정 가능, **카드 필요 없음**).
2. **Create a cluster → M0 (Free)** 선택. 지역은 가까운 곳(서울 또는 도쿄)을 고른다.
3. **Database Access → Add New Database User**: 아이디/비밀번호를 만든다. 비밀번호는 영문+숫자만 쓰면 편하다 (특수문자는 주소에서 깨질 수 있음).
4. **Network Access → Add IP Address → Allow Access from Anywhere (0.0.0.0/0)**. Render 서버 주소가 바뀌기 때문에 필요하다.
5. **Connect → Drivers** 에서 연결 문자열을 복사한다.
   `mongodb+srv://아이디:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   → `<password>` 를 3번에서 만든 비밀번호로 바꾼다.
   ⚠ 이 문자열은 비밀번호다. 저장소나 단톡방에 올리지 않는다.

### ② Render (5분)
1. https://render.com 에 **GitHub 계정으로 가입** (무료 플랜은 카드 필요 없음).
2. **New → Blueprint** → 이 저장소(`hoje-hoje/MP_2026`) 선택. Render는 보통 기본 브랜치(main)를 배포한다.
3. 설정 화면에서 **MONGODB_URI** 칸에 ①-5의 문자열을 붙여 넣고 만든다.
4. 몇 분 뒤 로그에 `저장소: MongoDB (mp2026.state)` 가 보이면 성공. 주소: `https://mp2026.onrender.com` (이름은 다를 수 있음).
5. **학교 크롬북 + 학교 와이파이로 접속 테스트.**

### ③ 잠들지 않게 깨우기 (UptimeRobot, 3분)
1. https://uptimerobot.com 무료 가입.
2. **New Monitor → HTTP(s)**, 주소 `https://(내 서버).onrender.com/health`, 간격 **5분**.
3. 이제 5분마다 서버를 깨워서 잠들지 않는다. (무료 750시간/월 → 서버 하나는 한 달 내내 켜 둘 수 있다)

### 업데이트
저장소(main)에 코드가 올라가면 Render가 자동으로 새 버전을 배포한다. 배포·재시작 때 10~20초 끊기지만 데이터는 Atlas에 있어서 그대로 이어진다.

### 행사 시작 전 할 일
- Render 환경변수 `TEST_MODE` 를 `0` 으로 → '지금 전투 처리' 테스트 버튼이 사라지고, 건국은 12/15까지만 열린다.
- 진짜 문제 파일 `server/puzzles.local.json` 은 저장소에 없으므로 Render에서는 **Secret File** 로 넣는다 (Render → 서비스 → Environment → Secret Files → 파일 이름 `puzzles.local.json` 으로 내용 붙여 넣기. 서버가 `/etc/secrets/puzzles.local.json` 을 자동으로 읽는다).

### 무료로 버벅이면
Render 서비스 플랜만 **Starter(월 $7)** 로 바꾸면 된다. 데이터는 Atlas에 있으니 그대로 이어진다. (해외 결제 카드 필요)

## 3. 주의
- 저장소는 **공개**다. 운영진 비밀번호, 진짜 쿠폰 코드는 저장소에 넣지 말고 서버 환경변수로만 넣는다.
- 균열 위치(`rift`)는 서버가 참가자에게 보내는 지도에서 지운다 (`/world.json`).
- `MONGODB_URI`(DB 비밀번호 포함)는 Render 환경변수에만 넣는다.
