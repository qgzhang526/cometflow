# report capability

平台自举验证报告。

## FR-REPORT-001 报告内容

报告覆盖 H1~H4 四条实验假设，逐条给出数据与判定。

## 验收

- A401：报告包含 spec→trace 闭环通过率数据（H1）
- A402：报告包含 plan validate/review 捕获的问题数（H2）
- A403：报告包含 eval 门禁拦截或未拦截的回归记录（H3）
- A404：报告包含无人值守完成率与断点恢复记录（H4）

## FR-REPORT-002 平台发现

报告记录平台自身缺陷与改进项清单。

## 验收

- A410：报告列出平台缺陷/改进项清单（含 evolve verify 默认门禁现状）
- A411：报告落在 reports/ 目录且可被 spec trace 引用
