<?php
/**
 * Plugin Name: AI News Feed
 * Description: Renders an automated AI/DevOps/cloud news feed from a JSON URL produced by a GitHub Actions pipeline. Shortcodes: [ai_news_feed] (simple grid) and [ai_news_feed_page] (full magazine layout).
 * Version:     0.4.0
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

function ainf_image_base_url() {
    $settings = ainf_get_settings();
    $json_url = trim($settings['json_url']);
    if ($json_url === '') return '';
    return preg_replace('#/news\.json$#', '/images/', $json_url);
}

function ainf_render_card($article, $image_base = '') {
    $title         = isset($article['title']) ? (string) $article['title'] : '';
    $summary       = isset($article['summary']) ? (string) $article['summary'] : '';
    $url           = isset($article['url']) ? (string) $article['url'] : '';
    $source        = isset($article['source']) ? (string) $article['source'] : '';
    $score         = isset($article['score']) ? (int) $article['score'] : 0;
    $category      = isset($article['category']) ? (string) $article['category'] : 'Other';
    $tags          = isset($article['tags']) && is_array($article['tags']) ? $article['tags'] : array();
    $publishedAt   = isset($article['publishedAt']) ? (string) $article['publishedAt'] : '';
    $imageFilename = isset($article['imageFilename']) ? (string) $article['imageFilename'] : '';

    $image_url = '';
    if ($imageFilename !== '' && $image_base !== '' && preg_match('/^[a-zA-Z0-9._-]+$/', $imageFilename)) {
        $image_url = $image_base . $imageFilename;
    }

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
        <?php if ($image_url !== '') : ?>
            <a href="<?php echo esc_url($url); ?>" rel="nofollow noopener" target="_blank" class="ainf-image-link" aria-hidden="true" tabindex="-1">
                <img class="ainf-image" src="<?php echo esc_url($image_url); ?>" alt="" loading="lazy" decoding="async" width="1280" height="720">
            </a>
        <?php endif; ?>
        <div class="ainf-card-body">
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
        </div>
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

    wp_enqueue_style('ainf-style', plugin_dir_url(__FILE__) . 'style.css', array(), '0.4.0');

    if (empty($articles)) {
        $msg = isset($data['error']) && $data['error']
            ? esc_html__('News feed is currently unavailable.', 'ai-news-feed')
            : esc_html__('No articles to show yet.', 'ai-news-feed');
        return '<div class="ainf-empty">' . $msg . '</div>';
    }

    $image_base = ainf_image_base_url();
    $out = '<div class="ainf-grid">';
    foreach ($articles as $article) {
        $out .= ainf_render_card($article, $image_base);
    }
    $out .= '</div>';
    return $out;
}
add_shortcode('ai_news_feed', 'ainf_shortcode');

/* -----------------------------------------------------------------
 * Magazine layout — [ai_news_feed_page]
 *
 * Full Develeap news-page layout: hero + featured 2x2 + Top Stories rail
 * + search/sort + filter pills + main grid. Uses ainfp- class prefix to
 * avoid collisions with the simple [ai_news_feed] grid above.
 * ----------------------------------------------------------------- */

function ainfp_render_site_header() {
    ob_start();
    ?>
    <header class="ainfp-site-header">
        <div class="ainfp-site-header-inner">
            <a class="ainfp-logo" href="/" aria-label="Develeap home">
                <span class="ainfp-logo-mark" aria-hidden="true">
                    <svg width="26" height="26" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="22" cy="22" r="16" fill="#F5B100"/>
                        <rect x="6" y="44" width="32" height="52" fill="#0B0F19"/>
                        <path d="M 48 8 L 60 8 Q 92 8 92 52 Q 92 96 60 96 L 48 96 Z" fill="#0B0F19"/>
                    </svg>
                </span>
                <span class="ainfp-logo-text">develeap</span>
            </a>
            <nav class="ainfp-nav" aria-label="Primary">
                <a href="#">Services <span class="ainfp-caret" aria-hidden="true">▾</span></a>
                <a href="#">Labs</a>
                <a href="#">Training <span class="ainfp-caret" aria-hidden="true">▾</span></a>
                <a href="#">Learn <span class="ainfp-caret" aria-hidden="true">▾</span></a>
                <a href="#">Company <span class="ainfp-caret" aria-hidden="true">▾</span></a>
            </nav>
            <a class="ainfp-cta" href="#">Get Your Expert</a>
        </div>
    </header>
    <?php
    return ob_get_clean();
}

function ainfp_score_class($score) {
    return $score >= 8 ? 'ainfp-score--high' : 'ainfp-score--mid';
}

function ainfp_relative_time($iso) {
    $ts = strtotime((string) $iso);
    if (!$ts) return '';
    $diff = max(0, time() - $ts);
    if ($diff < 60) return 'just now';
    if ($diff < 3600) return floor($diff / 60) . 'm ago';
    if ($diff < 86400) return floor($diff / 3600) . 'h ago';
    if ($diff < 2592000) return floor($diff / 86400) . 'd ago';
    return floor($diff / 2592000) . 'mo ago';
}

/**
 * Map article source name -> brand slug for color tinting.
 * Slugs match CSS rules in style.css [data-source="..."].
 * Brand palette sourced from .claude/skills/develeap-news-imagery/references/brand-colors.md.
 */
function ainfp_source_slug($source) {
    $s = strtolower((string) $source);
    if ($s === '') return '';
    if (strpos($s, 'aws') !== false)                                                            return 'aws';
    if (strpos($s, 'kubernetes') !== false || strpos($s, 'cncf') !== false)                     return 'kubernetes';
    if (strpos($s, 'anthropic') !== false)                                                      return 'anthropic';
    if (strpos($s, 'openai') !== false)                                                         return 'openai';
    if (strpos($s, 'github') !== false)                                                         return 'github';
    if (strpos($s, 'hashicorp') !== false || strpos($s, 'terraform') !== false)                 return 'hashicorp';
    if (strpos($s, 'docker') !== false)                                                         return 'docker';
    if (strpos($s, 'nvidia') !== false)                                                         return 'nvidia';
    if (strpos($s, 'hugging face') !== false)                                                   return 'huggingface';
    if (strpos($s, 'microsoft') !== false || strpos($s, 'azure') !== false)                     return 'microsoft';
    if (strpos($s, 'deepmind') !== false || strpos($s, 'google') !== false)                     return 'google';
    if (strpos($s, 'databricks') !== false)                                                     return 'databricks';
    if (strpos($s, 'snyk') !== false)                                                           return 'snyk';
    if (strpos($s, 'cisa') !== false)                                                           return 'cisa';
    if (strpos($s, 'stripe') !== false)                                                         return 'stripe';
    if (strpos($s, 'cloudflare') !== false)                                                     return 'cloudflare';
    if (strpos($s, 'meta') !== false || strpos($s, 'llama') !== false)                          return 'meta';
    if (strpos($s, 'krebs') !== false || strpos($s, 'hacker news') !== false ||
        strpos($s, 'project zero') !== false)                                                   return 'security';
    return '';
}

function ainfp_image_url_for($article, $image_base) {
    $imageFilename = isset($article['imageFilename']) ? (string) $article['imageFilename'] : '';
    if ($imageFilename === '' || $image_base === '') return '';
    if (!preg_match('/^[a-zA-Z0-9._-]+$/', $imageFilename)) return '';
    return $image_base . $imageFilename;
}

function ainfp_score_display($score) {
    $score = (float) $score;
    return number_format($score, 1);
}

function ainfp_render_featured_card($article, $image_base) {
    $title       = isset($article['title']) ? (string) $article['title'] : '';
    $url         = isset($article['url']) ? (string) $article['url'] : '';
    $source      = isset($article['source']) ? (string) $article['source'] : '';
    $score       = isset($article['score']) ? (int) $article['score'] : 0;
    $category    = isset($article['category']) ? (string) $article['category'] : 'Other';
    $publishedAt = isset($article['publishedAt']) ? (string) $article['publishedAt'] : '';
    $image_url   = ainfp_image_url_for($article, $image_base);
    $rel_time    = ainfp_relative_time($publishedAt);
    $score_class = ainfp_score_class($score);

    ob_start();
    ?>
    <a class="ainfp-featured-card" data-category="<?php echo esc_attr($category); ?>" data-source="<?php echo esc_attr(ainfp_source_slug($source)); ?>" href="<?php echo esc_url($url); ?>" rel="nofollow noopener" target="_blank" style="<?php echo $image_url ? 'background-image:url(' . esc_url($image_url) . ');' : ''; ?>">
        <span class="ainfp-featured-source"><?php echo esc_html($source); ?></span>
        <span class="ainfp-featured-score <?php echo esc_attr($score_class); ?>"><?php echo esc_html(ainfp_score_display($score)); ?></span>
        <div class="ainfp-featured-overlay">
            <h3 class="ainfp-featured-title"><?php echo esc_html($title); ?></h3>
            <?php if ($rel_time !== '') : ?>
                <span class="ainfp-featured-time"><?php echo esc_html($rel_time); ?></span>
            <?php endif; ?>
        </div>
    </a>
    <?php
    return ob_get_clean();
}

function ainfp_render_top_story_item($article, $image_base) {
    $title       = isset($article['title']) ? (string) $article['title'] : '';
    $url         = isset($article['url']) ? (string) $article['url'] : '';
    $source      = isset($article['source']) ? (string) $article['source'] : '';
    $score       = isset($article['score']) ? (int) $article['score'] : 0;
    $category    = isset($article['category']) ? (string) $article['category'] : 'Other';
    $publishedAt = isset($article['publishedAt']) ? (string) $article['publishedAt'] : '';
    $image_url   = ainfp_image_url_for($article, $image_base);
    $rel_time    = ainfp_relative_time($publishedAt);
    $score_class = ainfp_score_class($score);

    ob_start();
    ?>
    <a class="ainfp-top-item" data-category="<?php echo esc_attr($category); ?>" data-source="<?php echo esc_attr(ainfp_source_slug($source)); ?>" href="<?php echo esc_url($url); ?>" rel="nofollow noopener" target="_blank">
        <div class="ainfp-top-thumb">
            <?php if ($image_url !== '') : ?>
                <img src="<?php echo esc_url($image_url); ?>" alt="" loading="lazy" decoding="async">
            <?php endif; ?>
            <span class="ainfp-top-score <?php echo esc_attr($score_class); ?>"><?php echo esc_html(ainfp_score_display($score)); ?></span>
        </div>
        <div class="ainfp-top-meta">
            <h4 class="ainfp-top-title"><?php echo esc_html($title); ?></h4>
            <span class="ainfp-top-sub">
                <span class="ainfp-top-source"><?php echo esc_html($source); ?></span>
                <?php if ($rel_time !== '') : ?>
                    <span class="ainfp-top-time"> · <?php echo esc_html($rel_time); ?></span>
                <?php endif; ?>
            </span>
        </div>
    </a>
    <?php
    return ob_get_clean();
}

function ainfp_render_grid_card($article, $image_base) {
    $title         = isset($article['title']) ? (string) $article['title'] : '';
    $summary       = isset($article['summary']) ? (string) $article['summary'] : '';
    $url           = isset($article['url']) ? (string) $article['url'] : '';
    $source        = isset($article['source']) ? (string) $article['source'] : '';
    $score         = isset($article['score']) ? (int) $article['score'] : 0;
    $category      = isset($article['category']) ? (string) $article['category'] : 'Other';
    $tags          = isset($article['tags']) && is_array($article['tags']) ? $article['tags'] : array();
    $publishedAt   = isset($article['publishedAt']) ? (string) $article['publishedAt'] : '';
    $image_url     = ainfp_image_url_for($article, $image_base);
    $score_class   = ainfp_score_class($score);

    $date_display = '';
    $ts = $publishedAt ? strtotime($publishedAt) : 0;
    if ($ts) $date_display = date_i18n('M j, Y', $ts);

    $search_blob = strtolower($title . ' ' . $summary . ' ' . $source . ' ' . implode(' ', $tags));

    ob_start();
    ?>
    <article class="ainfp-grid-card"
             data-category="<?php echo esc_attr($category); ?>"
             data-source="<?php echo esc_attr(ainfp_source_slug($source)); ?>"
             data-score="<?php echo esc_attr((string) $score); ?>"
             data-date="<?php echo esc_attr($publishedAt); ?>"
             data-search="<?php echo esc_attr($search_blob); ?>">
        <a class="ainfp-grid-image" href="<?php echo esc_url($url); ?>" rel="nofollow noopener" target="_blank" aria-hidden="true" tabindex="-1">
            <?php if ($image_url !== '') : ?>
                <img src="<?php echo esc_url($image_url); ?>" alt="" loading="lazy" decoding="async" width="1280" height="720">
            <?php endif; ?>
            <span class="ainfp-grid-badge <?php echo esc_attr($score_class); ?>">
                <span class="ainfp-grid-badge-num"><?php echo esc_html(ainfp_score_display($score)); ?></span>
                <span class="ainfp-grid-badge-label">IMPACT</span>
            </span>
        </a>
        <div class="ainfp-grid-body">
            <div class="ainfp-grid-meta">
                <span class="ainfp-grid-source"><?php echo esc_html($source); ?></span>
                <?php if ($date_display !== '') : ?>
                    <time class="ainfp-grid-date" datetime="<?php echo esc_attr($publishedAt); ?>"><?php echo esc_html($date_display); ?></time>
                <?php endif; ?>
            </div>
            <h3 class="ainfp-grid-title">
                <a href="<?php echo esc_url($url); ?>" rel="nofollow noopener" target="_blank"><?php echo esc_html($title); ?></a>
            </h3>
            <?php if ($summary !== '') : ?>
                <p class="ainfp-grid-summary"><?php echo esc_html($summary); ?></p>
            <?php endif; ?>
            <?php if (!empty($tags)) : ?>
                <ul class="ainfp-grid-tags">
                    <?php foreach ($tags as $tag) : ?>
                        <li>#<?php echo esc_html(strtolower((string) $tag)); ?></li>
                    <?php endforeach; ?>
                </ul>
            <?php endif; ?>
        </div>
    </article>
    <?php
    return ob_get_clean();
}

function ainfp_page_shortcode($atts) {
    $atts = shortcode_atts(array(
        'limit'    => 60,
        'featured' => 4,
        'top'      => 5,
    ), $atts, 'ai_news_feed_page');

    $limit    = max(1, (int) $atts['limit']);
    $n_featured = max(0, (int) $atts['featured']);
    $n_top    = max(0, (int) $atts['top']);

    $data = ainf_fetch_data();
    $articles = isset($data['articles']) ? $data['articles'] : array();

    wp_enqueue_style('ainf-style', plugin_dir_url(__FILE__) . 'style.css', array(), '0.4.0');
    wp_enqueue_script('ainfp-script', plugin_dir_url(__FILE__) . 'script.js', array(), '0.4.0', true);

    if (empty($articles)) {
        $msg = isset($data['error']) && $data['error']
            ? esc_html__('News feed is currently unavailable.', 'ai-news-feed')
            : esc_html__('No articles to show yet.', 'ai-news-feed');
        return '<div class="ainfp-empty">' . $msg . '</div>';
    }

    $image_base = ainf_image_base_url();

    // Sort by score desc, ties broken by published date desc, for featured + top picks.
    $by_score = $articles;
    usort($by_score, function ($a, $b) {
        $sa = isset($a['score']) ? (int) $a['score'] : 0;
        $sb = isset($b['score']) ? (int) $b['score'] : 0;
        if ($sa !== $sb) return $sb <=> $sa;
        $da = isset($a['publishedAt']) ? strtotime($a['publishedAt']) : 0;
        $db = isset($b['publishedAt']) ? strtotime($b['publishedAt']) : 0;
        return $db <=> $da;
    });

    $featured_articles = array_slice($by_score, 0, $n_featured);
    $top_articles      = array_slice($by_score, $n_featured, $n_top);

    // Main grid: all articles, capped at limit, in their existing order (date desc per pipeline).
    $grid_articles = array_slice($articles, 0, $limit);

    // Categories present (for filter pills).
    $cats_seen = array();
    foreach ($articles as $a) {
        $c = isset($a['category']) ? (string) $a['category'] : '';
        if ($c !== '' && !in_array($c, $cats_seen, true)) $cats_seen[] = $c;
    }

    ob_start();
    ?>
    <div class="ainfp-site">
        <?php echo ainfp_render_site_header(); ?>
        <div class="ainfp-page">
        <header class="ainfp-hero">
            <h1 class="ainfp-hero-title">The develeap news feed</h1>
            <p class="ainfp-hero-tagline">A curated, ranked stream of the news that actually moves our craft.</p>
        </header>

        <section class="ainfp-spotlight">
            <div class="ainfp-featured-grid">
                <?php foreach ($featured_articles as $a) echo ainfp_render_featured_card($a, $image_base); ?>
            </div>
            <aside class="ainfp-top-rail">
                <div class="ainfp-top-rail-header">
                    <span class="ainfp-top-rail-title">Top Stories</span>
                    <a class="ainfp-top-rail-link" href="#ainfp-grid">View all →</a>
                </div>
                <div class="ainfp-top-list">
                    <?php foreach ($top_articles as $a) echo ainfp_render_top_story_item($a, $image_base); ?>
                </div>
            </aside>
        </section>

        <div class="ainfp-controls">
            <label class="ainfp-search">
                <svg class="ainfp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input type="search" class="ainfp-search-input" placeholder="Search news, sources, topics…" autocomplete="off">
            </label>
            <div class="ainfp-sort">
                <span class="ainfp-sort-label">Sort:</span>
                <select class="ainfp-sort-select">
                    <option value="score">Most important</option>
                    <option value="date">Newest first</option>
                </select>
            </div>
        </div>

        <div class="ainfp-pills">
            <button type="button" class="ainfp-pill is-active" data-filter="">All</button>
            <?php foreach ($cats_seen as $c) : ?>
                <button type="button" class="ainfp-pill" data-filter="<?php echo esc_attr($c); ?>"><?php echo esc_html($c); ?></button>
            <?php endforeach; ?>
        </div>

        <div id="ainfp-grid" class="ainfp-grid">
            <?php foreach ($grid_articles as $a) echo ainfp_render_grid_card($a, $image_base); ?>
        </div>
        </div>
    </div>
    <?php
    return ob_get_clean();
}
add_shortcode('ai_news_feed_page', 'ainfp_page_shortcode');

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
[ai_news_feed category="DevOps"]            Filter by category (AI, DevOps, Cloud, Engineering, Security, Other)
[ai_news_feed limit="5" category="AI"]      Combined</code></pre>
    </div>
    <?php
}
