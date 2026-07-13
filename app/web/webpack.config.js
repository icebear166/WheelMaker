const path = require('path');
const os = require('os');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');

function envFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function jsFilename(isProduction) {
  return pathData => {
    if (isProduction) {
      const chunkName = pathData?.chunk?.name;
      return chunkName ? `${chunkName}.[contenthash].js` : '[name].[contenthash].js';
    }
    return '[name].js';
  };
}

function jsChunkFilename(isProduction) {
  return () => (isProduction ? '[name].[contenthash].js' : '[name].js');
}

function cssFilename(isProduction) {
  return pathData => {
    if (isProduction) {
      const chunkName = pathData?.chunk?.name;
      return chunkName ? `${chunkName}.[contenthash].css` : '[name].[contenthash].css';
    }
    return '[name].css';
  };
}

function cssChunkFilename(isProduction) {
  return () => (isProduction ? '[name].[contenthash].css' : '[name].css');
}

module.exports = (_env = {}, argv = {}) => {
  const mode = argv.mode || process.env.NODE_ENV || 'development';
  const isProduction = mode === 'production';
  const webTarget = process.env.WHEELMAKER_WEB_TARGET
    ? path.resolve(process.env.WHEELMAKER_WEB_TARGET)
    : path.join(os.homedir(), '.wheelmaker', 'web');

  return {
    mode,
    entry: {
      bundle: path.resolve(__dirname, 'src/main.tsx'),
    },
    output: {
      path: webTarget,
      filename: jsFilename(isProduction),
      chunkFilename: jsChunkFilename(isProduction),
      publicPath: isProduction ? 'auto' : '/',
      clean: true,
    },
    cache: {
      type: 'filesystem',
      cacheDirectory: path.join(os.homedir(), '.wheelmaker', 'cache', 'webpack'),
      buildDependencies: {
        config: [__filename, path.resolve(__dirname, '..', 'package-lock.json')],
      },
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
    },
    module: {
      rules: [
        {
          test: /\.m?js$/,
          resolve: {
            fullySpecified: false,
          },
        },
        {
          test: /\.[jt]sx?$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              babelrc: false,
              configFile: false,
              presets: ['@babel/preset-env', '@babel/preset-react', '@babel/preset-typescript'],
            },
          },
        },
        {
          test: /\.css$/,
          use: [isProduction ? MiniCssExtractPlugin.loader : 'style-loader', 'css-loader'],
        },
        {
          test: /\.(woff2?|ttf|eot|svg)$/,
          type: 'asset/resource',
          generator: {
            filename: pathData => {
              const rawFilename = pathData.filename || '';
              return rawFilename.replace(/\\/g, '/').includes('@vscode/codicons/dist/codicon.ttf')
                ? 'codicon.ttf'
                : '[hash][ext][query]';
            },
          },
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, 'public/index.html'),
        inject: 'body',
      }),
      ...(isProduction ? [new MiniCssExtractPlugin({
        filename: cssFilename(isProduction),
        chunkFilename: cssChunkFilename(isProduction),
      })] : []),
    ],
    devServer: {
      host: '0.0.0.0',
      port: 8080,
      allowedHosts: 'all',
      historyApiFallback: true,
      static: {
        directory: path.resolve(__dirname, 'public'),
      },
    },
    performance: {
      hints: false,
    },
    optimization: {
      minimizer: [new TerserPlugin({ parallel: false })],
    },
    devtool: isProduction && !envFlag(process.env.WHEELMAKER_WEB_ENABLE_SOURCEMAP)
      ? false
      : 'source-map',
  };
};
