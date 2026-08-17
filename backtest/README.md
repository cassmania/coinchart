# 4축 합성 신호 재현 절차

이 폴더는 사이트가 화면에서 사용하는 `analysis-engine.js`의 `compositeSignal()`을 그대로 백테스트합니다.

```powershell
node backtest/fetch-snapshot.js
node backtest/signal-backtest.js
```

- `fetch-snapshot.js`는 Bybit USDT 무기한 선물 일봉을 내려받아 `backtest/data`에 고정합니다.
- `data/manifest.json`에는 출처, 기간, 캔들 수, SHA-256 해시를 기록합니다.
- `signal-backtest.js`는 저장된 스냅샷만 사용하고 네트워크를 호출하지 않습니다.
- 결과는 `backtest/results/signal-report.json`과 `signal-report.md`에 저장됩니다.
- 새 데이터를 받으면 스냅샷과 결과가 바뀌므로 기존 결과를 보존하려면 먼저 백업해야 합니다.

체결 규칙은 `config.js`에 고정되어 있습니다. 신호가 나온 일봉의 다음 봉 시가에 진입하고, 같은 봉에서 손절과 익절이 모두 닿으면 보수적으로 손절 처리합니다. 수수료와 슬리피지는 진입·청산 양쪽에 각각 적용합니다.
