# Double Cross 3rd Edition System for Foundry VTT

Maintained by Nayuri ([EnYuri](https://github.com/EnYuri/Dx3rd_Emanim)).

Fork of [lichsoma/double-cross-3rd](https://github.com/lichsoma/double-cross-3rd),
which is itself a fork of [ksx0330/FVTT-DX3rd-System](https://github.com/ksx0330/FVTT-DX3rd-System).

Licensed under the MIT License — see [LICENSE.md](LICENSE.md). Original copyright is retained.

# ♀️ 어두운 에마님 진실 ♀️

AI 활용으로 작성된 모독적인 모듈.

## 컴펜디움 릴리즈

비공개 `_source/`는 배포하지 않는다. Foundry를 종료한 뒤 `powershell -ExecutionPolicy Bypass -File tools/release.ps1`를 실행하면, 비공개 소스에서 LevelDB 컴펜디움을 임시 스테이징에 빌드하고 Foundry 런타임 파일과 `packs/`만 포함한 `dist/*.zip`을 생성한다. 빌드는 설치된 Foundry의 데이터베이스 라이브러리를 사용하며, [공식 Foundry CLI](https://github.com/foundryvtt/foundryvtt-cli)가 설치되어 있으면 그것을 우선 사용한다.

처음 한 번 `powershell -ExecutionPolicy Bypass -File tools/setup-git-hooks.ps1`를 실행한다. 이후 Foundry를 종료한 상태에서 커밋하면, `pre-commit` 훅이 `system.json`의 patch 버전을 자동 증가시킨다(수동으로 다른 버전을 스테이징한 경우 그 값을 유지). 이어서 비공개 생성기(CSV·오버라이드 → JSON)를 실행하고 선언된 컴펜디움을 빌드한 뒤 결과 `packs/`만 자동 스테이징한다. `main`에 푸시하면 Actions는 공개 런타임 파일과 그 커밋의 `packs/`만으로 GitHub Release를 생성한다. 해당 Release의 `system.json`과 ZIP은 `releases/latest/download/` URL로 제공되므로 Foundry의 매니페스트 업데이트를 그대로 지원한다.

---
