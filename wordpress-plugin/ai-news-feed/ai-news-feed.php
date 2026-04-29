<?php
/**
 * Plugin Name: AI News Feed
 * Description: Renders an automated AI/DevOps/cloud news feed from a JSON URL produced by a GitHub Actions pipeline. Use the [ai_news_feed] shortcode on any page.
 * Version:     0.1.0
 * Author:      AI News Feed
 * License:     MIT
 */

if (!defined('ABSPATH')) {
    exit;
}

const AINF_OPTION_KEY     = 'ainf_settings';
const AINF_TRANSIENT_KEY  = 'ainf_data';
const AINF_DEFAULT_TTL    = 3600;
const AINF_DEFAULT_LIMIT  = 50;
const AINF_HTTP_TIMEOUT   = 10;
const AINF_SCHEMA_VERSION = 1;

function ainf_get_settings() {
    $defaults = array(
        'json_url'  => '',
        'cache_ttl' => AINF_DEFAULT_TTL,
    );
    $saved = get_option(AINF_OPTION_KEY, array());
    return wp_parse_args(is_array($saved) ? $saved : array(), $defaults);
}

function ainf_fetch_data($force = false) {
    if (!$force) {
        $cached = get_transient(AINF_TRANSIENT_KEY);
        if (is_array($cached)) {
            return $cached;
        }
    }

    $settings = ainf_get_settings();
    $url      = trim($settings['json_url']);
    if ($url === '') {
        return array('articles' => array(), 'error' => 'JSON URL is not configured.');
    }

    $response = wp_remote_get($url, array(
        'timeout' => AINF_HTTP_TIMEOUT,
        'headers' => array('Accept' => 'application/json'),
    ));
    if (is_wp_error($response)) {
        return array('articles' => array(), 'error' => $response->get_error_message());
    }
    $code = wp_remote_retrieve_response_code($response);
    if ($code !== 200) {
        return array('articles' => array(), 'error' => 'HTTP ' . $code);
    }
    $body   = wp_remote_retrieve_body($response);
    $parsed = json_decode($body, true);
    if (!is_array($parsed) || !isset($parsed['articles']) || !is_array($parsed['articles'])) {
        return array('articles' => array(), 'error' => 'Malformed JSON.');
    }
    if (isset($parsed['schemaVersion']) && (int) $parsed['schemaVersion'] !== AINF_SCHEMA_VERSION) {
        return array('articles' => array(), 'error' => 'Unsupported schemaVersion.');
    }

    $ttl = max(60, (int) $settings['cache_ttl']);
    set_transient(AINF_TRANSIENT_KEY, $parsed, $ttl);
    return $parsed;
}

function ainf_render_card($article) {
    $title       = isset($article['title']) ? (string) $article['title'] : '';
    $summary     = isset($article['summary']) ? (string) $article['summary'] : '';
    $url         = isset($article['url']) ? (string) $article['url'] : '';
    $source      = isset($article['source']) ? (string) $article['source'] : '';
    $score       = isset($article['score']) ? (int) $article['score'] : 0;
    $category    = isset($article['category']) ? (string) $article['category'] : 'Other';
    $tags        = isset($article['tags']) && is_array($article['tags']) ? $article['tags'] : array();
    $publishedAt = isset($article['publishedAt']) ? (string) $article['publishedAt'] : '';

    $date_display = '';
    if ($publishedAt !== '') {
        $ts = strtotime($publishedAt);
        if ($ts) {
            $date_display = date_i18n(get_option('date_format'), $ts);
        }
    }

    ob_start();
    ?>
    <article class="ainf-card" data-category="<?php echo esc_attr($category); ?>">
        <header class="ainf-card-header">
            <span class="ainf-category"><?php echo esc_html($category); ?></span>
            <span class="ainf-score" title="Editorial score 1-10"><?php echo esc_html($score); ?>/10</span>
        </header>
        <h3 class="ainf-title">
            <a href="<?php echo esc_url($url); ?>" rel="nofollow noopener" target="_blank"><?php echo esc_html($title); ?></a>
        </h3>
        <p class="ainf-summary"><?php echo esc_html($summary); ?></p>
        <footer class="ainf-card-footer">
            <span class="ainf-source"><?php echo esc_html($source); ?></span>
            <?php if ($date_display !== '') : ?>
                <time class="ainf-date" datetime="<?php echo esc_attr($publishedAt); ?>"><?php echo esc_html($date_display); ?></time>
            <?php endif; ?>
            <?php if (!empty($tags)) : ?>
                <ul class="ainf-tags">
                    <?php foreach ($tags as $tag) : ?>
                        <li><?php echo esc_html((string) $tag); ?></li>
                    <?php endforeach; ?>
                </ul>
            <?php endif; ?>
        </footer>
    </article>
    <?php
    return ob_get_clean();
}

function ainf_shortcode($atts) {
    $atts = shortcode_atts(array(
        'limit'    => AINF_DEFAULT_LIMIT,
        'category' => '',
    ), $atts, 'ai_news_feed');

    $limit    = max(1, (int) $atts['limit']);
    $category = trim((string) $atts['category']);

    $data = ainf_fetch_data();
    $articles = isset($data['articles']) ? $data['articles'] : array();

    if ($category !== '') {
        $articles = array_values(array_filter($articles, function ($a) use ($category) {
            return isset($a['category']) && strcasecmp($a['category'], $category) === 0;
        }));
    }
    $articles = array_slice($articles, 0, $limit);

    wp_enqueue_style('ainf-style', plugin_dir_url(__FILE__) . 'style.css', array(), '0.1.0');

    if (empty($articles)) {
        $msg = isset($data['error']) && $data['error']
            ? esc_html__('News feed is currently unavailable.', 'ai-news-feed')
            : esc_html__('No articles to show yet.', 'ai-news-feed');
        return '<div class="ainf-empty">' . $msg . '</div>';
    }

    $out = '<div class="ainf-grid">';
    foreach ($articles as $article) {
        $out .= ainf_render_card($article);
    }
    $out .= '</div>';
    return $out;
}
add_shortcode('ai_news_feed', 'ainf_shortcode');

function ainf_register_settings_page() {
    add_options_page(
        'AI News Feed',
        'AI News Feed',
        'manage_options',
        'ai-news-feed',
        'ainf_render_settings_page'
    );
}
add_action('admin_menu', 'ainf_register_settings_page');

function ainf_register_settings() {
    register_setting('ainf_settings_group', AINF_OPTION_KEY, array(
        'type'              => 'array',
        'sanitize_callback' => 'ainf_sanitize_settings',
        'default'           => array('json_url' => '', 'cache_ttl' => AINF_DEFAULT_TTL),
    ));
}
add_action('admin_init', 'ainf_register_settings');

function ainf_sanitize_settings($input) {
    $clean = array();
    $clean['json_url']  = isset($input['json_url']) ? esc_url_raw(trim((string) $input['json_url'])) : '';
    $clean['cache_ttl'] = isset($input['cache_ttl']) ? max(60, (int) $input['cache_ttl']) : AINF_DEFAULT_TTL;
    return $clean;
}

function ainf_handle_clear_cache() {
    if (!current_user_can('manage_options')) {
        wp_die('Insufficient permissions.');
    }
    check_admin_referer('ainf_clear_cache');
    delete_transient(AINF_TRANSIENT_KEY);
    wp_safe_redirect(add_query_arg(array('page' => 'ai-news-feed', 'cache_cleared' => '1'), admin_url('options-general.php')));
    exit;
}
add_action('admin_post_ainf_clear_cache', 'ainf_handle_clear_cache');

function ainf_render_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    $settings = ainf_get_settings();
    ?>
    <div class="wrap">
        <h1>AI News Feed</h1>

        <?php if (!empty($_GET['cache_cleared'])) : ?>
            <div class="notice notice-success is-dismissible"><p>Cache cleared. The next page load will refetch the JSON.</p></div>
        <?php endif; ?>

        <form method="post" action="options.php">
            <?php settings_fields('ainf_settings_group'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="ainf_json_url">JSON URL</label></th>
                    <td>
                        <input
                            type="url"
                            class="regular-text"
                            id="ainf_json_url"
                            name="<?php echo esc_attr(AINF_OPTION_KEY); ?>[json_url]"
                            value="<?php echo esc_attr($settings['json_url']); ?>"
                            placeholder="https://raw.githubusercontent.com/&lt;user&gt;/&lt;repo&gt;/main/data/news.json"
                            required
                        >
                        <p class="description">Public raw URL of <code>data/news.json</code> from your GitHub repo.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="ainf_cache_ttl">Cache duration (seconds)</label></th>
                    <td>
                        <input
                            type="number"
                            min="60"
                            id="ainf_cache_ttl"
                            name="<?php echo esc_attr(AINF_OPTION_KEY); ?>[cache_ttl]"
                            value="<?php echo esc_attr($settings['cache_ttl']); ?>"
                        >
                        <p class="description">How long WordPress caches the JSON between fetches. Default 3600 (1 hour).</p>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>

        <hr>

        <h2>Cache</h2>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="ainf_clear_cache">
            <?php wp_nonce_field('ainf_clear_cache'); ?>
            <p>Force a fresh fetch on the next page load.</p>
            <?php submit_button('Clear cache now', 'secondary', 'submit', false); ?>
        </form>

        <hr>

        <h2>Usage</h2>
        <p>Add the shortcode to any page or post:</p>
        <pre><code>[ai_news_feed]                              Full feed
[ai_news_feed limit="10"]                   First 10 articles
[ai_news_feed category="DevOps"]            Filter by category (AI, DevOps, Cloud, Engineering, Other)
[ai_news_feed limit="5" category="AI"]      Combined</code></pre>
    </div>
    <?php
}
