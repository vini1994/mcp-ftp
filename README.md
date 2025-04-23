# Servidor MCP para FTP/SSH

Este servidor MCP permite conectar-se e manipular arquivos em servidores FTP, SFTP e SSH diretamente do Cursor AI, facilitando a gestão de hospedagens WordPress e outros servidores remotos.

## Funcionalidades

- Conectar a servidores FTP, SFTP e SSH
- Listar arquivos e diretórios
- Fazer upload e download de arquivos
- Criar, remover e renomear arquivos e diretórios
- Ler e escrever conteúdo de arquivos
- Suporte a múltiplas conexões simultâneas

## Instalação

1. Certifique-se de ter o Node.js instalado (v14+)
2. Clone este repositório ou copie a pasta MCP
3. Instale as dependências:

```bash
cd MCP
npm install
```

## Uso no Cursor

### Configuração do Cursor

O arquivo de configuração `.cursor/mcp.json` já está incluído e configurado. O Cursor deve reconhecer automaticamente o servidor MCP.

### Iniciar o servidor

Você pode iniciar o servidor MCP de duas formas:

1. **Modo stdio** (recomendado para uso com Cursor):
```bash
npm start
```

2. **Modo HTTP** (para desenvolvimento ou uso com outras ferramentas):
```bash
npm run start:http
```

### Exemplo de uso no Cursor

Aqui está um exemplo de como usar o servidor MCP no Cursor:

```
// Conectar a um servidor FTP
connect(type="ftp", host="meu-servidor.com", port=21, username="usuario", password="senha")

// Conectar a um servidor SFTP/SSH
connect(type="sftp", host="meu-servidor.com", port=22, username="usuario", password="senha")

// Listar arquivos em um diretório
list_directory(connectionId="conn_id_retornado", path="/caminho/remoto")

// Fazer upload de um arquivo
upload_file(connectionId="conn_id_retornado", localPath="/caminho/local/arquivo.txt", remotePath="/caminho/remoto/arquivo.txt")

// Baixar um arquivo
download_file(connectionId="conn_id_retornado", remotePath="/caminho/remoto/arquivo.txt", localPath="/caminho/local/arquivo.txt")

// Ler o conteúdo de um arquivo
read_file(connectionId="conn_id_retornado", path="/caminho/remoto/arquivo.txt")

// Escrever conteúdo em um arquivo
write_file(connectionId="conn_id_retornado", path="/caminho/remoto/arquivo.txt", content="Novo conteúdo do arquivo")

// Desconectar quando terminar
disconnect(connectionId="conn_id_retornado")
```

## Ferramentas disponíveis

| Ferramenta | Descrição |
|------------|-----------|
| `connect` | Conecta a um servidor FTP, SFTP ou SSH |
| `list_directory` | Lista arquivos e diretórios em um caminho remoto |
| `download_file` | Baixa um arquivo do servidor remoto |
| `upload_file` | Envia um arquivo para o servidor remoto |
| `delete_file` | Exclui um arquivo do servidor remoto |
| `create_directory` | Cria um diretório no servidor remoto |
| `remove_directory` | Remove um diretório do servidor remoto |
| `rename` | Renomeia um arquivo ou diretório no servidor remoto |
| `read_file` | Lê o conteúdo de um arquivo do servidor remoto |
| `write_file` | Escreve conteúdo em um arquivo no servidor remoto |
| `disconnect` | Fecha uma conexão com o servidor |

## Segurança

- As senhas e chaves privadas são usadas apenas para autenticação e não são armazenadas permanentemente
- Todas as conexões são gerenciadas durante a sessão e fechadas ao encerrar o processo
- Para maior segurança, recomenda-se usar autenticação por chave em vez de senha

## Solução de problemas

Se você encontrar problemas ao usar este servidor MCP:

1. Verifique se todas as dependências estão instaladas
2. Certifique-se de que as portas e credenciais de acesso estão corretas
3. Verifique se o servidor remoto está acessível a partir da sua rede
4. Para conexões SFTP/SSH, considere usar o parâmetro `privateKey` em vez de `password`

## Licença

MIT 