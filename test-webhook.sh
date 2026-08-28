#!/bin/bash
# имитирует вебхук от meta с новым комментарием, чтобы протестировать логику без реальной инсты

curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "entry": [{
      "changes": [{
        "field": "comments",
        "value": {
          "id": "fake_comment_id_123",
          "from": { "id": "fake_user_id_456" },
          "text": "хочу цену!"
        }
      }]
    }]
  }'
