// cloudflare-worker.js - D1数据库版

// 数据库初始化函数（懒加载模式）
async function ensureDatabaseInitialized(env) {
  // 检查表是否已存在
  try {
    await env.DB.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        comment TEXT NOT NULL,
        color TEXT DEFAULT 'black',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_hash TEXT,
        user_agent TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_comments_email ON comments(email);
    `);
    console.log("✅ 数据库表已初始化");
  } catch (error) {
    console.error("❌ 数据库初始化失败:", error);
  }
}

export default {
  async fetch(request, env) {
    // CORS 设置
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    
    // 健康检查 - 包含数据库状态
    if (url.pathname === '/health') {
      try {
        // 确保数据库已初始化
        await ensureDatabaseInitialized(env);
        
        // 获取留言数量
        const countResult = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM comments"
        ).first();
        
        const commentCount = countResult ? countResult.count : 0;
        
        return new Response(JSON.stringify({ 
          status: 'ok', 
          timestamp: new Date().toISOString(),
          commentsCount: commentCount,
          storage: 'D1 Database',
          database: env.DB.database_name || 'tomoe_hiyori_db'
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          status: 'error',
          error: error.message 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // 获取留言 - 修改部分
    if (url.pathname === '/api/comments' && request.method === 'GET') {
      try {
        // 确保数据库已初始化
        await ensureDatabaseInitialized(env);
        
        const limit = parseInt(url.searchParams.get('limit')) || 100;
        const offset = parseInt(url.searchParams.get('offset')) || 0;
        
        const { results } = await env.DB.prepare(
          `SELECT id, email, comment, color, 
                  created_at as timestamp,
                  ip_hash, user_agent
           FROM comments 
           ORDER BY created_at DESC 
           LIMIT ? OFFSET ?`
        ).bind(limit, offset).all();
        
        return new Response(JSON.stringify(results), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: '获取留言失败',
          details: error.message 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // 提交留言 - 修改部分
    if (url.pathname === '/api/comments' && request.method === 'POST') {
      try {
        // 确保数据库已初始化
        await ensureDatabaseInitialized(env);
        
        const data = await request.json();
        const { email, comment, color = 'black' } = data;
        
        // 获取请求者信息（可选）
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const userAgent = request.headers.get('User-Agent') || 'unknown';
        
        // 简单的IP哈希（保护隐私）
        const ipHash = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(ip)
        ).then(hash => 
          Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('')
            .substring(0, 16)
        );

        // 插入到数据库
        const result = await env.DB.prepare(
          `INSERT INTO comments (email, comment, color, ip_hash, user_agent)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(
          email, 
          comment, 
          color,
          ipHash,
          userAgent.substring(0, 255) // 限制长度
        ).run();

        // 获取最新的一条留言返回
        const newComment = await env.DB.prepare(
          `SELECT id, email, comment, color, 
                  created_at as timestamp
           FROM comments 
           WHERE id = ?`
        ).bind(result.meta.last_row_id).first();

        return new Response(JSON.stringify({ 
          success: true,
          id: newComment.id,
          message: '留言提交成功！',
          comment: newComment
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          success: false,
          error: '提交失败',
          details: error.message 
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // 新增：删除留言（可选功能）
    if (url.pathname === '/api/comments' && request.method === 'DELETE') {
      try {
        const { id } = await request.json();
        
        if (!id) {
          return new Response(JSON.stringify({ 
            error: '需要留言ID'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const result = await env.DB.prepare(
          "DELETE FROM comments WHERE id = ?"
        ).bind(id).run();

        return new Response(JSON.stringify({ 
          success: result.meta.rows_written > 0,
          deleted: result.meta.rows_written
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: '删除失败'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // 新增：批量清理旧留言（可选）
    if (url.pathname === '/api/comments/cleanup' && request.method === 'POST') {
      try {
        const maxAge = parseInt(url.searchParams.get('days')) || 30;
        const cutoffDate = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);
        
        const result = await env.DB.prepare(
          "DELETE FROM comments WHERE created_at < ?"
        ).bind(cutoffDate.toISOString()).run();

        return new Response(JSON.stringify({ 
          success: true,
          deleted: result.meta.rows_written,
          message: `已清理${result.meta.rows_written}条${maxAge}天前的留言`
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: '清理失败'
        }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    // 新增：数据库管理端点（可选，生产环境建议移除）
    if (url.pathname === '/admin/db-info') {
      try {
        const tables = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table'"
        ).all();
        
        const commentCount = await env.DB.prepare(
          "SELECT COUNT(*) as count FROM comments"
        ).first();
        
        const recentComments = await env.DB.prepare(
          "SELECT created_at FROM comments ORDER BY created_at DESC LIMIT 1"
        ).first();
        
        return new Response(JSON.stringify({
          tables: tables.results,
          commentCount: commentCount.count,
          lastCommentTime: recentComments ? recentComments.created_at : null,
          databaseName: env.DB.database_name,
          timestamp: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
    }

    return new Response(JSON.stringify({ error: '未找到 API 端点' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
};