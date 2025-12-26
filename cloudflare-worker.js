// 内存版 Worker - 先确保能运行
let comments = [];

export default {
  async fetch(request, env) {
    // CORS 设置
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    // 健康检查
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        commentsCount: comments.length
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 获取留言
    if (url.pathname === '/api/comments' && request.method === 'GET') {
      return new Response(JSON.stringify(comments), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // 提交留言
    if (url.pathname === '/api/comments' && request.method === 'POST') {
      try {
        const data = await request.json();
        const { email, comment, color = 'black' } = data;

        const newComment = {
          id: Date.now(),
          email,
          comment,
          color,
          timestamp: new Date().toISOString(),
        };

        comments.unshift(newComment);
        
        if (comments.length > 100) {
          comments = comments.slice(0, 100);
        }

        return new Response(JSON.stringify({ 
          success: true,
          id: newComment.id,
          message: '留言提交成功！'
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      } catch (error) {
        return new Response(JSON.stringify({ 
          error: '请求格式错误'
        }), {
          status: 400,
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