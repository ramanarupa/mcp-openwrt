# Подключение OpenWRT MCP Server к Claude

Это руководство описывает подключение для **Claude Desktop** и **Claude Code CLI**.

## Шаг 1: Убедитесь что проект собран

```bash
cd E:\OpenWRT\mcp
npm run build
```

Должны увидеть: "tsc" выполнился без ошибок.

---

# Метод 1: Claude Code CLI (рекомендуется для CLI)

## Шаг 2: Создайте файл .mcp.json

Создайте файл `.mcp.json` в корне проекта (`E:\OpenWRT\mcp\.mcp.json`):

### Вариант A: Использование пароля

```json
{
  "mcpServers": {
    "openwrt": {
      "command": "node",
      "args": ["E:\\OpenWRT\\mcp\\build\\index.js"],
      "env": {
        "OPENWRT_HOST": "192.168.1.1",
        "OPENWRT_PORT": "22",
        "OPENWRT_USERNAME": "root",
        "OPENWRT_PASSWORD": "ваш_пароль_здесь"
      }
    }
  }
}
```

### Вариант B: Использование SSH ключа

```json
{
  "mcpServers": {
    "openwrt": {
      "command": "node",
      "args": ["E:\\OpenWRT\\mcp\\build\\index.js"],
      "env": {
        "OPENWRT_HOST": "192.168.1.1",
        "OPENWRT_PORT": "22",
        "OPENWRT_USERNAME": "root",
        "OPENWRT_PRIVATE_KEY": "-----BEGIN OPENSSH PRIVATE KEY-----\nваш_приватный_ключ_здесь\n-----END OPENSSH PRIVATE KEY-----"
      }
    }
  }
}
```

### ⚠️ ВАЖНО: Замените параметры на ваши:
- `OPENWRT_HOST` - IP адрес вашего OpenWRT роутера (например, 192.168.1.1)
- `OPENWRT_PORT` - SSH порт (обычно 22)
- `OPENWRT_USERNAME` - имя пользователя (обычно root)
- `OPENWRT_PASSWORD` - ваш пароль от роутера

## Шаг 3: Использование

1. Откройте Claude Code CLI из директории проекта: `cd E:\OpenWRT\mcp`
2. Claude Code автоматически обнаружит файл `.mcp.json`
3. При первом использовании Claude Code попросит подтверждение (это нормально)
4. Начните работать с роутером!

**Примечание:** Файл `.mcp.json` работает только когда вы запускаете Claude Code из директории `E:\OpenWRT\mcp\` (или её поддиректорий).

---

# Метод 2: Claude Desktop

## Шаг 2: Найдите конфигурационный файл Claude Desktop

### Windows
Файл находится по адресу:
```
%APPDATA%\Claude\claude_desktop_config.json
```

Полный путь обычно:
```
C:\Users\ВашеИмя\AppData\Roaming\Claude\claude_desktop_config.json
```

### macOS/Linux
```
~/.config/claude/claude_desktop_config.json
```

### Как открыть (Windows):
1. Нажмите `Win + R`
2. Введите: `%APPDATA%\Claude`
3. Нажмите Enter
4. Если файла `claude_desktop_config.json` нет - создайте его

## Шаг 3: Настройте подключение к вашему роутеру

Создайте или отредактируйте `claude_desktop_config.json`:

### Вариант A: Использование пароля

```json
{
  "mcpServers": {
    "openwrt": {
      "command": "node",
      "args": ["E:\\OpenWRT\\mcp\\build\\index.js"],
      "env": {
        "OPENWRT_HOST": "192.168.1.1",
        "OPENWRT_PORT": "22",
        "OPENWRT_USERNAME": "root",
        "OPENWRT_PASSWORD": "ваш_пароль_здесь"
      }
    }
  }
}
```

### Вариант B: Использование SSH ключа

```json
{
  "mcpServers": {
    "openwrt": {
      "command": "node",
      "args": ["E:\\OpenWRT\\mcp\\build\\index.js"],
      "env": {
        "OPENWRT_HOST": "192.168.1.1",
        "OPENWRT_PORT": "22",
        "OPENWRT_USERNAME": "root",
        "OPENWRT_PRIVATE_KEY": "-----BEGIN OPENSSH PRIVATE KEY-----\nваш_приватный_ключ_здесь\n-----END OPENSSH PRIVATE KEY-----"
      }
    }
  }
}
```

### ⚠️ ВАЖНО: Замените параметры на ваши:
- `OPENWRT_HOST` - IP адрес вашего OpenWRT роутера (например, 192.168.1.1)
- `OPENWRT_PORT` - SSH порт (обычно 22)
- `OPENWRT_USERNAME` - имя пользователя (обычно root)
- `OPENWRT_PASSWORD` - ваш пароль от роутера

## Шаг 4: Перезапустите Claude Desktop

1. Полностью закройте Claude Desktop
2. Откройте заново

## Шаг 5: Проверьте подключение

В Claude Desktop напишите:

```
Проверь подключение к OpenWRT роутеру и покажи информацию о системе
```

Если все работает, вы увидите информацию о вашем роутере!

---

---

## Решение проблем

### Проблема: "Failed to connect to OpenWRT"

**Решение:**
1. Проверьте что роутер доступен: `ping 192.168.1.1`
2. Проверьте SSH доступ: `ssh root@192.168.1.1`
3. Убедитесь что SSH сервер запущен на роутере
4. Проверьте правильность пароля/ключа

### Проблема: "Cannot find module"

**Решение:**
```bash
cd E:\OpenWRT\mcp
npm install
npm run build
```

### Проблема: MCP сервер не появляется в Claude

**Решение:**
1. Проверьте правильность JSON синтаксиса (запятые, кавычки)
2. Проверьте путь к `index.js` (используйте `\\` для Windows путей)
3. Перезапустите Claude полностью (закройте все окна)

### Проблема: "ENOENT: no such file or directory"

**Решение:**
Проверьте что путь к build/index.js правильный:
```bash
dir E:\OpenWRT\mcp\build\index.js
```

---

## Быстрая проверка конфигурации

### Для Claude Code CLI:

```bash
# Посмотреть содержимое
cat .mcp.json

# Или для Windows
type .mcp.json

# Проверить что файл существует
ls -la .mcp.json
```

### Для Claude Desktop:

```bash
# Посмотреть содержимое (Windows)
type %APPDATA%\Claude\claude_desktop_config.json

# Проверить что файл существует
dir %APPDATA%\Claude\claude_desktop_config.json
```

---

## Примеры использования после подключения

После успешного подключения попробуйте:

1. **Базовая проверка:**
   ```
   Покажи информацию о системе OpenWRT
   ```

2. **Анализ конфигурации:**
   ```
   Проанализируй текущую конфигурацию роутера
   ```

3. **Просмотр файлов:**
   ```
   Покажи мне конфигурацию сети
   ```

4. **Создание скрипта:**
   ```
   Создай скрипт резервного копирования
   ```

---

## Безопасность

⚠️ **ВАЖНО:**
- Файлы конфигурации (`.mcp.json` или `claude_desktop_config.json`) содержат пароли в открытом виде
- Не делитесь этими файлами с другими
- Добавьте `.mcp.json` в `.gitignore` если используете git
- Рассмотрите использование SSH ключей вместо паролей
- Убедитесь что роутер находится в защищенной сети

---

## Дополнительная настройка

### Если у вас несколько роутеров

Вы можете добавить несколько MCP серверов для разных роутеров:

**Для Claude Code CLI** (`.mcp.json`):
```json
{
  "mcpServers": {
    "openwrt-home": {
      "command": "node",
      "args": ["E:\\OpenWRT\\mcp\\build\\index.js"],
      "env": {
        "OPENWRT_HOST": "192.168.1.1",
        "OPENWRT_USERNAME": "root",
        "OPENWRT_PASSWORD": "пароль1"
      }
    },
    "openwrt-office": {
      "command": "node",
      "args": ["E:\\OpenWRT\\mcp\\build\\index.js"],
      "env": {
        "OPENWRT_HOST": "10.0.0.1",
        "OPENWRT_USERNAME": "root",
        "OPENWRT_PASSWORD": "пароль2"
      }
    }
  }
}
```

**Для Claude Desktop** (`claude_desktop_config.json`) - то же самое.

---

## Готово! 🎉

Теперь вы можете управлять своим OpenWRT роутером прямо из Claude Code CLI или Claude Desktop!
