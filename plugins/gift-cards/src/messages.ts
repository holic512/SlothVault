/** Plugin-owned messages ship with each independent release. */
export const messages = {
  "zh": {
    "Plugins": {
      "giftCards": {
        "manage": {
          "actions": {
            "refresh": "刷新",
            "create": "发行卡密",
            "generate": "生成卡密",
            "cancel": "取消",
            "confirmSaved": "我已保存",
            "copyAll": "复制全部卡密"
          },
          "messages": {
            "codesCopied": "卡密已复制",
            "copyFailed": "复制失败，请手动选择卡密复制。"
          },
          "table": {
            "batch": "批次",
            "points": "面值",
            "quantity": "数量",
            "redemption": "兑换进度",
            "expiresAt": "到期时间",
            "issuer": "发行人"
          },
          "pointsValue": "{value} 积分",
          "permanent": "长期有效",
          "dialog": {
            "createTitle": "发行积分卡密",
            "codesTitle": "卡密已生成",
            "codesDescription": "卡密已发行，也可随时在批次明细中查看和复制。"
          },
          "form": {
            "name": "批次名称",
            "points": "单卡积分",
            "quantity": "发行数量",
            "expiresAt": "到期时间（可选）"
          },
          "plaintextNotice": "卡密以明文保存，数据库和备份中也包含完整兑换码。",
          "allStatuses": "全部状态",
          "copyPage": "复制当前页",
          "copy": "复制",
          "code": "完整卡密",
          "status": "状态",
          "redeemedBy": "兑换人",
          "redeemedAt": "兑换时间",
          "statuses": {
            "unused": "未使用",
            "used": "已使用",
            "expired": "已过期",
            "disabled": "已停用"
          }
        },
        "redeem": {
          "kicker": "积分",
          "title": "卡密兑换",
          "description": "输入卡密领取积分；积分余额与流水请前往积分中心查看。",
          "redeemed": "已兑换 {points} 积分",
          "current": "当前积分",
          "redeemTitle": "兑换卡密",
          "codeRequired": "请输入卡密",
          "redeem": "兑换积分",
          "history": "积分记录",
          "table": {
            "time": "时间",
            "description": "说明",
            "defaultDescription": "积分变动",
            "change": "变动",
            "balance": "余额"
          },
          "code": "兑换码",
          "usePoints": "用积分开通会员",
          "error": "兑换未完成，请检查卡密后重试。",
          "invalidCode": "卡密无效、已使用或已过期，请检查后重试。"
        }
      }
    }
  },
  "en": {
    "Plugins": {
      "giftCards": {
        "manage": {
          "actions": {
            "refresh": "Refresh",
            "create": "Issue gift cards",
            "generate": "Generate codes",
            "cancel": "Cancel",
            "confirmSaved": "I saved them",
            "copyAll": "Copy all codes"
          },
          "messages": {
            "codesCopied": "Gift card codes copied",
            "copyFailed": "Copy failed. Select and copy the code manually."
          },
          "table": {
            "batch": "Batch",
            "points": "Value",
            "quantity": "Quantity",
            "redemption": "Redemption",
            "expiresAt": "Expires",
            "issuer": "Issuer"
          },
          "pointsValue": "{value} points",
          "permanent": "No expiry",
          "dialog": {
            "createTitle": "Issue point gift cards",
            "codesTitle": "Gift cards generated",
            "codesDescription": "Codes issued. You can view and copy them again in batch details."
          },
          "form": {
            "name": "Batch name",
            "points": "Points per card",
            "quantity": "Quantity",
            "expiresAt": "Expiry time (optional)"
          },
          "plaintextNotice": "Codes are stored in plaintext, including database backups.",
          "allStatuses": "All statuses",
          "copyPage": "Copy current page",
          "copy": "Copy",
          "code": "Full code",
          "status": "Status",
          "redeemedBy": "Redeemed by",
          "redeemedAt": "Redeemed at",
          "statuses": {
            "unused": "Unused",
            "used": "Used",
            "expired": "Expired",
            "disabled": "Disabled"
          }
        },
        "redeem": {
          "kicker": "Points",
          "title": "Redeem gift card",
          "description": "Redeem a code for points. View your balance and ledger in the points center.",
          "redeemed": "Redeemed {points} points",
          "current": "Current points",
          "redeemTitle": "Redeem a gift code",
          "codeRequired": "Enter a gift code",
          "redeem": "Redeem points",
          "history": "Points history",
          "table": {
            "time": "Time",
            "description": "Description",
            "defaultDescription": "Points adjustment",
            "change": "Change",
            "balance": "Balance"
          },
          "code": "Gift code",
          "usePoints": "Use points for membership",
          "error": "Redemption did not complete. Check your code and retry.",
          "invalidCode": "This code is invalid, already used, or expired. Check your code and retry."
        }
      }
    }
  }
} as const
