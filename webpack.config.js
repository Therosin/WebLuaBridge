const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: './src/lua_bridge.js',
  output: {
    filename: 'LuaBridge/index.js',
    path: path.resolve(__dirname, 'dist'),
    library: {
      name: 'LuaBridge',
      type: 'umd',
    },
    umdNamedDefine: true,
    globalObject: 'this',
  },
  resolve: {
    fallback: {
      path: false,
      fs: false,
      child_process: false,
      crypto: false,
      url: false,
      module: false,
    }
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { modules: false }],
            ],
          }
        },
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html',
      filename: 'index.html',
      inject: 'head',
    }),
    new webpack.ContextReplacementPlugin(
      /lazy-debug-legacy/,
      path.resolve(__dirname, 'src')
    ),
  ],
  optimization: {
    minimize: true,
    minimizer: [new TerserPlugin({
      terserOptions: {
        format: {
          // Retain JSDoc-style comments
          comments: '/^\\* @/',
        },
      },
      extractComments: false,
    })],
    splitChunks: false, // Disable
    runtimeChunk: false, // Disable runtime chunk
  },
  mode: 'production',
};
