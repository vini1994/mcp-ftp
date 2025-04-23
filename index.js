const { createServer } = require('fastmcp');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const { Client: FTPClient } = require('ftp');
const { Client: SSHClient } = require('ssh2');
const { isAbsolute, join, dirname, basename } = require('path');

// Criar servidor MCP
const server = createServer({
  name: 'vibe-coding-ftp-ssh',
  version: '1.0.0',
  description: 'Servidor MCP para conexão e manipulação de arquivos via FTP/SSH em hospedagens WordPress',
});

// Tipos de conectores
const CONNECTION_TYPES = {
  FTP: 'ftp',
  SFTP: 'sftp',
  SSH: 'ssh',
}

// Armazenar conexões ativas
const activeConnections = new Map();

// Esquemas de validação
const connectionSchema = z.object({
  type: z.enum([CONNECTION_TYPES.FTP, CONNECTION_TYPES.SFTP, CONNECTION_TYPES.SSH]),
  host: z.string(),
  port: z.number().optional(),
  username: z.string(),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
});

const fileOpsSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
});

// Função para gerar IDs de conexão
function generateConnectionId() {
  return `conn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

// Classe para padronizar operações em diferentes conexões
class FileSystemAdapter {
  constructor(type, connection) {
    this.type = type;
    this.connection = connection;
  }

  // Lista arquivos de um diretório
  async list(remotePath) {
    return new Promise((resolve, reject) => {
      if (this.type === CONNECTION_TYPES.FTP) {
        this.connection.list(remotePath, (err, list) => {
          if (err) return reject(err);
          resolve(list);
        });
      } else if (this.type === CONNECTION_TYPES.SFTP || this.type === CONNECTION_TYPES.SSH) {
        // Para conexões SSH, usamos o SFTP
        this.connection.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.readdir(remotePath, (err, list) => {
            if (err) return reject(err);
            resolve(list.map(item => ({
              name: item.filename,
              type: item.attrs.isDirectory() ? 'd' : '-',
              size: item.attrs.size,
              date: new Date(item.attrs.mtime * 1000),
              rights: {
                user: '',
                group: '',
                other: ''
              },
              owner: item.attrs.uid?.toString() || '',
              group: item.attrs.gid?.toString() || '',
            })));
          });
        });
      }
    });
  }

  // Baixa um arquivo
  async download(remotePath, localPath) {
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(localPath);
      
      if (this.type === CONNECTION_TYPES.FTP) {
        this.connection.get(remotePath, (err, stream) => {
          if (err) return reject(err);
          
          stream.pipe(writeStream);
          
          writeStream.on('finish', () => {
            resolve(localPath);
          });
          
          stream.on('error', (err) => {
            reject(err);
          });
        });
      } else if (this.type === CONNECTION_TYPES.SFTP || this.type === CONNECTION_TYPES.SSH) {
        this.connection.sftp((err, sftp) => {
          if (err) return reject(err);
          
          const readStream = sftp.createReadStream(remotePath);
          readStream.pipe(writeStream);
          
          writeStream.on('finish', () => {
            resolve(localPath);
          });
          
          readStream.on('error', (err) => {
            reject(err);
          });
        });
      }
    });
  }

  // Envia um arquivo
  async upload(localPath, remotePath) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(localPath)) {
        return reject(new Error(`Arquivo local não encontrado: ${localPath}`));
      }
      
      const readStream = fs.createReadStream(localPath);
      
      if (this.type === CONNECTION_TYPES.FTP) {
        this.connection.put(readStream, remotePath, (err) => {
          if (err) return reject(err);
          resolve(remotePath);
        });
      } else if (this.type === CONNECTION_TYPES.SFTP || this.type === CONNECTION_TYPES.SSH) {
        this.connection.sftp((err, sftp) => {
          if (err) return reject(err);
          
          const writeStream = sftp.createWriteStream(remotePath);
          readStream.pipe(writeStream);
          
          writeStream.on('close', () => {
            resolve(remotePath);
          });
          
          writeStream.on('error', (err) => {
            reject(err);
          });
        });
      }
    });
  }

  // Remove um arquivo
  async deleteFile(remotePath) {
    return new Promise((resolve, reject) => {
      if (this.type === CONNECTION_TYPES.FTP) {
        this.connection.delete(remotePath, (err) => {
          if (err) return reject(err);
          resolve(true);
        });
      } else if (this.type === CONNECTION_TYPES.SFTP || this.type === CONNECTION_TYPES.SSH) {
        this.connection.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.unlink(remotePath, (err) => {
            if (err) return reject(err);
            resolve(true);
          });
        });
      }
    });
  }

  // Cria um diretório
  async mkdir(remotePath) {
    return new Promise((resolve, reject) => {
      if (this.type === CONNECTION_TYPES.FTP) {
        this.connection.mkdir(remotePath, (err) => {
          if (err) return reject(err);
          resolve(true);
        });
      } else if (this.type === CONNECTION_TYPES.SFTP || this.type === CONNECTION_TYPES.SSH) {
        this.connection.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.mkdir(remotePath, (err) => {
            if (err) return reject(err);
            resolve(true);
          });
        });
      }
    });
  }

  // Remove um diretório
  async rmdir(remotePath, recursive = false) {
    return new Promise((resolve, reject) => {
      if (this.type === CONNECTION_TYPES.FTP) {
        this.connection.rmdir(remotePath, recursive, (err) => {
          if (err) return reject(err);
          resolve(true);
        });
      } else if (this.type === CONNECTION_TYPES.SFTP || this.type === CONNECTION_TYPES.SSH) {
        this.connection.sftp((err, sftp) => {
          if (err) return reject(err);

          // Para remoção recursiva em SFTP, precisamos implementar recursão manual
          if (recursive) {
            this.removeDirectoryRecursive(sftp, remotePath)
              .then(() => resolve(true))
              .catch(reject);
          } else {
            sftp.rmdir(remotePath, (err) => {
              if (err) return reject(err);
              resolve(true);
            });
          }
        });
      }
    });
  }
  
  // Função auxiliar para remover diretórios recursivamente via SFTP
  async removeDirectoryRecursive(sftp, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, async (err, list) => {
        if (err) return reject(err);
        
        // Se o diretório estiver vazio, podemos removê-lo diretamente
        if (list.length === 0) {
          sftp.rmdir(remotePath, (err) => {
            if (err) return reject(err);
            resolve();
          });
          return;
        }
        
        // Caso contrário, precisamos remover recursivamente cada item
        const promises = list.map(item => {
          const itemPath = path.posix.join(remotePath, item.filename);
          
          if (item.attrs.isDirectory()) {
            return this.removeDirectoryRecursive(sftp, itemPath);
          } else {
            return new Promise((resolve, reject) => {
              sftp.unlink(itemPath, (err) => {
                if (err) return reject(err);
                resolve();
              });
            });
          }
        });
        
        try {
          await Promise.all(promises);
          
          // Agora que o diretório está vazio, podemos removê-lo
          sftp.rmdir(remotePath, (err) => {
            if (err) return reject(err);
            resolve();
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  // Renomeia um arquivo ou diretório
  async rename(oldPath, newPath) {
    return new Promise((resolve, reject) => {
      if (this.type === CONNECTION_TYPES.FTP) {
        this.connection.rename(oldPath, newPath, (err) => {
          if (err) return reject(err);
          resolve(true);
        });
      } else if (this.type === CONNECTION_TYPES.SFTP || this.type === CONNECTION_TYPES.SSH) {
        this.connection.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.rename(oldPath, newPath, (err) => {
            if (err) return reject(err);
            resolve(true);
          });
        });
      }
    });
  }

  // Obtém o conteúdo de um arquivo como texto
  async readFile(remotePath) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      
      if (this.type === CONNECTION_TYPES.FTP) {
        this.connection.get(remotePath, (err, stream) => {
          if (err) return reject(err);
          
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
          stream.on('error', (err) => {
            reject(err);
          });
        });
      } else if (this.type === CONNECTION_TYPES.SFTP || this.type === CONNECTION_TYPES.SSH) {
        this.connection.sftp((err, sftp) => {
          if (err) return reject(err);
          
          const readStream = sftp.createReadStream(remotePath);
          
          readStream.on('data', (chunk) => chunks.push(chunk));
          readStream.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
          readStream.on('error', (err) => {
            reject(err);
          });
        });
      }
    });
  }

  // Grava o conteúdo de texto em um arquivo
  async writeFile(remotePath, content) {
    return new Promise((resolve, reject) => {
      const buffer = Buffer.from(content);
      
      if (this.type === CONNECTION_TYPES.FTP) {
        this.connection.put(buffer, remotePath, (err) => {
          if (err) return reject(err);
          resolve(true);
        });
      } else if (this.type === CONNECTION_TYPES.SFTP || this.type === CONNECTION_TYPES.SSH) {
        this.connection.sftp((err, sftp) => {
          if (err) return reject(err);
          
          const writeStream = sftp.createWriteStream(remotePath);
          
          writeStream.end(buffer);
          
          writeStream.on('close', () => {
            resolve(true);
          });
          
          writeStream.on('error', (err) => {
            reject(err);
          });
        });
      }
    });
  }
  
  // Fecha a conexão
  async close() {
    return new Promise((resolve) => {
      if (this.connection) {
        this.connection.end();
        this.connection = null;
      }
      resolve();
    });
  }
}

// Função para conectar via FTP
async function connectFTP(config) {
  return new Promise((resolve, reject) => {
    const client = new FTPClient();
    
    client.on('ready', () => {
      resolve(client);
    });
    
    client.on('error', (err) => {
      reject(err);
    });
    
    const ftpConfig = {
      host: config.host,
      port: config.port || 21,
      user: config.username,
      password: config.password,
    };
    
    client.connect(ftpConfig);
  });
}

// Função para conectar via SSH/SFTP
async function connectSSH(config) {
  return new Promise((resolve, reject) => {
    const client = new SSHClient();
    
    client.on('ready', () => {
      resolve(client);
    });
    
    client.on('error', (err) => {
      reject(err);
    });
    
    const sshConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
    };
    
    // Definir autenticação
    if (config.password) {
      sshConfig.password = config.password;
    } else if (config.privateKey) {
      sshConfig.privateKey = config.privateKey;
      if (config.passphrase) {
        sshConfig.passphrase = config.passphrase;
      }
    }
    
    client.connect(sshConfig);
  });
}

// ========= FERRAMENTAS MCP ==========

// Conectar a um servidor FTP/SSH
server.addTool({
  name: 'connect',
  description: 'Conecta a um servidor FTP ou SSH',
  parameters: connectionSchema,
  execute: async (params) => {
    try {
      let connection;
      let adapter;
      const connectionId = generateConnectionId();
      
      if (params.type === CONNECTION_TYPES.FTP) {
        connection = await connectFTP(params);
        adapter = new FileSystemAdapter(CONNECTION_TYPES.FTP, connection);
      } else {
        connection = await connectSSH(params);
        adapter = new FileSystemAdapter(
          params.type === CONNECTION_TYPES.SFTP ? CONNECTION_TYPES.SFTP : CONNECTION_TYPES.SSH, 
          connection
        );
      }
      
      // Armazenar a conexão para uso posterior
      activeConnections.set(connectionId, adapter);
      
      return {
        success: true,
        connectionId,
        message: `Conectado com sucesso ao servidor ${params.host} via ${params.type.toUpperCase()}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Listar arquivos e diretórios
server.addTool({
  name: 'list_directory',
  description: 'Lista arquivos e diretórios em um caminho remoto',
  parameters: fileOpsSchema,
  execute: async (params) => {
    try {
      const adapter = activeConnections.get(params.connectionId);
      if (!adapter) {
        return {
          success: false,
          error: 'Conexão não encontrada. Conecte-se primeiro usando connect()'
        };
      }
      
      const files = await adapter.list(params.path);
      return {
        success: true,
        path: params.path,
        files: files
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Baixar arquivo
server.addTool({
  name: 'download_file',
  description: 'Baixa um arquivo do servidor remoto',
  parameters: z.object({
    connectionId: z.string(),
    remotePath: z.string(),
    localPath: z.string(),
  }),
  execute: async (params) => {
    try {
      const adapter = activeConnections.get(params.connectionId);
      if (!adapter) {
        return {
          success: false,
          error: 'Conexão não encontrada. Conecte-se primeiro usando connect()'
        };
      }
      
      // Certifique-se de que o diretório local existe
      const dir = dirname(params.localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      const result = await adapter.download(params.remotePath, params.localPath);
      return {
        success: true,
        localPath: result,
        message: `Arquivo baixado com sucesso para ${params.localPath}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Enviar arquivo
server.addTool({
  name: 'upload_file',
  description: 'Envia um arquivo para o servidor remoto',
  parameters: z.object({
    connectionId: z.string(),
    localPath: z.string(),
    remotePath: z.string(),
  }),
  execute: async (params) => {
    try {
      const adapter = activeConnections.get(params.connectionId);
      if (!adapter) {
        return {
          success: false,
          error: 'Conexão não encontrada. Conecte-se primeiro usando connect()'
        };
      }
      
      const result = await adapter.upload(params.localPath, params.remotePath);
      return {
        success: true,
        remotePath: result,
        message: `Arquivo enviado com sucesso para ${params.remotePath}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Excluir arquivo
server.addTool({
  name: 'delete_file',
  description: 'Exclui um arquivo do servidor remoto',
  parameters: fileOpsSchema,
  execute: async (params) => {
    try {
      const adapter = activeConnections.get(params.connectionId);
      if (!adapter) {
        return {
          success: false,
          error: 'Conexão não encontrada. Conecte-se primeiro usando connect()'
        };
      }
      
      await adapter.deleteFile(params.path);
      return {
        success: true,
        message: `Arquivo ${params.path} excluído com sucesso`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Criar diretório
server.addTool({
  name: 'create_directory',
  description: 'Cria um diretório no servidor remoto',
  parameters: fileOpsSchema,
  execute: async (params) => {
    try {
      const adapter = activeConnections.get(params.connectionId);
      if (!adapter) {
        return {
          success: false,
          error: 'Conexão não encontrada. Conecte-se primeiro usando connect()'
        };
      }
      
      await adapter.mkdir(params.path);
      return {
        success: true,
        message: `Diretório ${params.path} criado com sucesso`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Remover diretório
server.addTool({
  name: 'remove_directory',
  description: 'Remove um diretório do servidor remoto',
  parameters: z.object({
    connectionId: z.string(),
    path: z.string(),
    recursive: z.boolean().optional().default(false),
  }),
  execute: async (params) => {
    try {
      const adapter = activeConnections.get(params.connectionId);
      if (!adapter) {
        return {
          success: false,
          error: 'Conexão não encontrada. Conecte-se primeiro usando connect()'
        };
      }
      
      await adapter.rmdir(params.path, params.recursive);
      return {
        success: true,
        message: `Diretório ${params.path} removido com sucesso`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Renomear arquivo ou diretório
server.addTool({
  name: 'rename',
  description: 'Renomeia um arquivo ou diretório no servidor remoto',
  parameters: z.object({
    connectionId: z.string(),
    oldPath: z.string(),
    newPath: z.string(),
  }),
  execute: async (params) => {
    try {
      const adapter = activeConnections.get(params.connectionId);
      if (!adapter) {
        return {
          success: false,
          error: 'Conexão não encontrada. Conecte-se primeiro usando connect()'
        };
      }
      
      await adapter.rename(params.oldPath, params.newPath);
      return {
        success: true,
        message: `Arquivo/diretório renomeado com sucesso de ${params.oldPath} para ${params.newPath}`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Ler conteúdo de arquivo
server.addTool({
  name: 'read_file',
  description: 'Lê o conteúdo de um arquivo do servidor remoto',
  parameters: fileOpsSchema,
  execute: async (params) => {
    try {
      const adapter = activeConnections.get(params.connectionId);
      if (!adapter) {
        return {
          success: false,
          error: 'Conexão não encontrada. Conecte-se primeiro usando connect()'
        };
      }
      
      const content = await adapter.readFile(params.path);
      return {
        success: true,
        path: params.path,
        content: content
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Escrever conteúdo em arquivo
server.addTool({
  name: 'write_file',
  description: 'Escreve conteúdo em um arquivo no servidor remoto',
  parameters: z.object({
    connectionId: z.string(),
    path: z.string(),
    content: z.string(),
  }),
  execute: async (params) => {
    try {
      const adapter = activeConnections.get(params.connectionId);
      if (!adapter) {
        return {
          success: false,
          error: 'Conexão não encontrada. Conecte-se primeiro usando connect()'
        };
      }
      
      await adapter.writeFile(params.path, params.content);
      return {
        success: true,
        message: `Arquivo ${params.path} escrito com sucesso`
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Fechar conexão
server.addTool({
  name: 'disconnect',
  description: 'Fecha uma conexão com o servidor',
  parameters: z.object({
    connectionId: z.string(),
  }),
  execute: async (params) => {
    try {
      const adapter = activeConnections.get(params.connectionId);
      if (!adapter) {
        return {
          success: false,
          error: 'Conexão não encontrada'
        };
      }
      
      await adapter.close();
      activeConnections.delete(params.connectionId);
      
      return {
        success: true,
        message: 'Desconectado com sucesso'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Iniciar o servidor com base nos argumentos
const httpMode = process.argv.includes('--http');

if (httpMode) {
  const port = process.env.PORT || 3001;
  const host = process.env.HOST || '0.0.0.0';
  server.listen({ port, host }).then(() => {
    console.log(`Servidor MCP FTP/SSH rodando em http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
  });
} else {
  server.start();
  console.log('Servidor MCP FTP/SSH iniciado no modo stdio');
}

// Limpar conexões ao encerrar o processo
process.on('SIGINT', async () => {
  console.log('Encerrando conexões ativas...');
  
  const promises = [];
  for (const [id, adapter] of activeConnections.entries()) {
    promises.push(adapter.close());
    activeConnections.delete(id);
  }
  
  await Promise.all(promises);
  console.log('Todas as conexões foram fechadas. Encerrando...');
  process.exit(0);
}); 