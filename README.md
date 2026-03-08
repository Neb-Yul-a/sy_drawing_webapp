# 🎨 그림 놀이 (Kids Drawing App)

아이를 위한 터치 기반 그림 놀이 웹앱입니다.

구형 iPad (iPad 3, iOS 9.3.6)에서도 동작하도록 설계되었습니다.

## 기능

### 🖊 그리기 도구
- **연필** — 기본 펜
- **마커** — 반투명 두꺼운 펜
- **크레용** — 텍스처가 있는 크레용 느낌
- **무지개** — 색이 자동으로 바뀌는 레인보우 펜
- **반짝이** — 파티클이 흩뿌려지는 스파클 펜

### 🧰 도구
- **지우개** — 부분 지우기
- **페인트 통** — 영역 색 채우기 (flood fill)
- **도장** — 다양한 모양의 스탬프 찍기
- **되돌리기** — Undo (최대 5단계)
- **전체 지우기** — 확인 팝업 포함
- **저장** — 이미지 미리보기 (길게 눌러 저장)

### 🖍 색칠 공부
다양한 색칠 공부 템플릿 제공

### 🎨 색상 & 굵기
- 14가지 색상 팔레트
- 3단계 펜 굵기

## 기술 스택

- HTML5 Canvas
- Vanilla JavaScript (ES5)
- CSS3 (webkit prefix 포함)
- AppCache (오프라인 지원)

## 호환성

- iOS 9.3.6 Safari (iPad 3)
- Touch events 기반 (pointer events 미사용)
- `CanvasRenderingContext2D.ellipse` polyfill 포함
- Viewport 고정 (핀치 줌 / 더블탭 줌 / 스크롤 방지)

## 배포

GitHub Pages로 정적 호스팅:

https://neb-yul-a.github.io/sy_drawing_webapp/

## 로컬 실행

```bash
python3 -m http.server 8080
```

`http://localhost:8080` 에서 확인
