const path         = require("path");
const TerserPlugin = require('terser-webpack-plugin');


module.exports = {
	mode:         "production",
	entry:        {
		"tattler.min": "./src/Tattler-js/Tattler.js"
	},
	output:       {
		path: path.resolve(__dirname, "dist"),
	},
	module:       {
		rules: [
			{
				test:    /\.js$/,
				exclude: /node_modules/,
				use:     {
					loader: "babel-loader",
				},
			}
		],
	},
	optimization: {
		minimize:  true,
		minimizer: [new TerserPlugin()],
	},
	performance:  {
		hints:             false,
		maxEntrypointSize: 512000,
		maxAssetSize:      512000
	}
};
