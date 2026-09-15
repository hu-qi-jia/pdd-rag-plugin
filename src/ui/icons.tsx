/**
 * 共享图标 — 统一走 lucide-react(24×24 画布 / 2px 描边 / 圆角线帽),
 * 与 ChatGPT / Codex 内置图标同一设计语言;currentColor 继承主题令牌。
 */
export {
  Sun as SunIcon,
  Moon as MoonIcon,
  Settings as GearIcon,
  ExternalLink as ExternalLinkIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  FolderPlus as FolderPlusIcon,
  FolderInput as FolderInputIcon,
  List as ListIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronDown as ChevronDownIcon,
  Trash2 as TrashIcon,
  Download as DownloadIcon,
  Upload as UploadIcon,
  X as XIcon,
  ArrowUpWideNarrow as ArrowUpWideNarrowIcon,
  ArrowDownWideNarrow as ArrowDownWideNarrowIcon,
  Search as SearchIcon,
  Plus as PlusIcon,
  Copy as CopyIcon,
  Check as CheckIcon,
  Pencil as PencilIcon,
  Sparkles as SparklesIcon,
  BookOpen as BookOpenIcon,
  MessageSquare as MessageSquareIcon,
  Clock as ClockIcon,
  FileText as FileTextIcon,
  CornerDownLeft as FillIcon,
  Star as StarIcon,
  Loader2 as LoaderIcon,
} from 'lucide-react'

import { Sparkles as LucideSparkles } from 'lucide-react'

interface IconProps {
  size?: number
}

/** AI 徽标图标(品牌时刻:Sparkles,emerald 强调色) */
export const AiSparkIcon = ({ size = 14 }: IconProps) => (
  <LucideSparkles size={size} strokeWidth={2} />
)
