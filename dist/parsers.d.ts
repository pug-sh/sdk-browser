interface UserAgentProps {
    $browser?: string;
    $browserVersion?: string;
    $os?: string;
    $osVersion?: string;
    $device?: string;
    $mobile?: string;
}
export declare const initUserAgentData: () => void;
export declare const parseUserAgentData: () => UserAgentProps;
interface UtmParams {
    $utmSource?: string;
    $utmMedium?: string;
    $utmCampaign?: string;
    $utmContent?: string;
    $utmTerm?: string;
}
export declare const parseUtmParams: (search: string) => UtmParams;
export {};
