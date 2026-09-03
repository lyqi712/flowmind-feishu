export const FEISHU_OPEN_PLATFORM = 'https://open.feishu.cn/app';

export const FEISHU_APP_PERMISSION_STEPS = [
  {
    title: '创建企业自建应用',
    detail: '打开飞书开放平台，创建企业自建应用。App ID 和 App Secret 只填在本机向导，不会进 Git。',
    href: FEISHU_OPEN_PLATFORM
  },
  {
    title: '开通只读权限并发布',
    detail: '权限管理搜索开通云文档、知识库、云空间只读，以及文档媒体下载。保存后创建版本并发布到本企业。'
  },
  {
    title: '把文档授权给这个应用',
    detail: '在飞书文档或知识空间右上角「… → 添加文档应用 / 添加知识库应用」，否则粘贴链接也发现不到。'
  }
];

export const FEISHU_APP_SCOPE_LABELS = [
  { id: 'docx:document:readonly', label: '云文档正文' },
  { id: 'wiki:wiki:readonly', label: '知识库 Wiki' },
  { id: 'drive:drive:readonly', label: '云空间与文件夹' },
  { id: 'docs:document.media:download', label: '文档图片和附件' }
];
