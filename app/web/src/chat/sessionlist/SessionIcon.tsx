// The shared Lucide icon system lives in common/Icon. SessionIcon is preserved
// as a thin re-export so existing chat/sessionlist callers and tests keep their
// import paths and behavior. New surfaces should import Icon from common/Icon.
export {Icon as SessionIcon} from '../../common/Icon';
export type {IconName as SessionIconName} from '../../common/Icon';
export {ICON_NAMES as SESSION_ICON_NAMES} from '../../common/Icon';
