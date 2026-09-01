# auth capability

## POST /api/auth/email-login

使用邮箱验证码登录。

## POST /api/auth/register

注册新用户。

## Acceptance

- A1：未注册邮箱可以获取验证码
- A2：验证码错误返回 401 INVALID_CODE
