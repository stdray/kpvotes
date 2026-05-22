export interface Vote {
	Uri: string;
	Name: string;
	Vote: number;
}

export interface Config {
	kpUri: string;
	votesUri: string;
	cachePath: string;
	intervalMinutes: number;
	userAgent: string;
	twitter: {
		appKey: string;
		appSecret: string;
		accessToken: string;
		accessSecret: string;
	};
	proxy?: {
		server: string;
		username?: string;
		password?: string;
	};
	lightpanda: {
		cdpUrl: string;
	};
}
