# Agent Note：可视化工作流审计清单

状态：已实现

[English](2026-09-23-workflow-audit-manifest.md) | 中文

## 问题

可视化工作流 Host 过去只按运行 ID 接收节点审计事件。恶意或过期脚本可能因此向某次运行历史写入无关节点记录。

## 决策

可视化编译器现在会随生成脚本返回节点标识清单。`workflowStart` 会校验清单的数量、格式和唯一性，并将其绑定到运行记录。Session Controller 的审计处理器会忽略不在清单中的节点事件，也会忽略运行结束后的更新。该清单只约束可视化编辑器的直接 API，普通工作流引擎运行保持原有行为。

## 结果

可视化工作流历史只会保留本次提交图中声明的节点记录。调用可视化启动接口的旧客户端需要补充节点清单。未知审计事件不再污染内存视图或 Session 历史。

## 验证

工作流、PTC、UI Layout 和 Session Controller 测试共 1094 个用例通过。包级 TypeScript、工作流 Guest 校验、Client UI 国际化校验、持久化目录校验和 `git diff --check` 均通过。
